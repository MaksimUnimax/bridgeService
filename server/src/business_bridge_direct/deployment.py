"""Fail-closed, no-follow permission normalization for Direct staging trees."""
from __future__ import annotations

import os
import stat
from pathlib import Path
from typing import Iterable


def _canonical_root(value: str | os.PathLike[str]) -> Path:
    root = Path(value)
    if not root.is_absolute():
        raise ValueError("staging_root_not_absolute")
    if root.is_symlink() or not root.is_dir():
        raise ValueError("invalid_staging_root")
    return root.resolve(strict=True)


def _inside(path: Path, root: Path) -> bool:
    try:
        path.resolve(strict=False).relative_to(root)
        return True
    except ValueError:
        return False


def _rel(path: Path, root: Path) -> str:
    return str(path.relative_to(root))


def _interpreter_link(rel: str) -> bool:
    parts = Path(rel).parts
    return len(parts) >= 3 and parts[-3] in {".venv", "venv"} and parts[-2] == "bin" and parts[-1].startswith("python")


def _owner_class(uid: int) -> str:
    return "root" if uid == 0 else "other"


def _group_class(gid: int, expected_gid: int) -> str:
    return "service-group" if gid == expected_gid else "other"


def _inventory_entry(path: Path, root: Path, expected_gid: int) -> dict[str, object]:
    st = os.lstat(path)
    mode = stat.S_IMODE(st.st_mode)
    if stat.S_ISDIR(st.st_mode): kind = "directory"
    elif stat.S_ISREG(st.st_mode): kind = "regular"
    elif stat.S_ISLNK(st.st_mode): kind = "symlink"
    else: kind = "unsafe"
    return {"path": _rel(path, root), "type": kind, "owner_class": _owner_class(st.st_uid),
            "group_class": _group_class(st.st_gid, expected_gid), "mode": oct(mode)}


def normalize_staging_runtime(
    staging_root: str | os.PathLike[str],
    expected_uid: int,
    expected_gid: int,
    allowed_subtree_roots: Iterable[str | os.PathLike[str]],
) -> list[dict[str, object]]:
    """Validate and normalize a complete installed runtime before activation.

    The complete tree is validated before any mutation. Symlinks are inspected
    with lstat and are never traversed or mutated. Interpreter links may point
    at an external, pre-existing executable; their target metadata is recorded
    but never changed.
    """
    root = _canonical_root(staging_root)
    allowed = []
    for raw in allowed_subtree_roots:
        candidate = (root / Path(raw)).resolve(strict=True) if not Path(raw).is_absolute() else Path(raw).resolve(strict=True)
        if not _inside(candidate, root):
            raise ValueError("invalid_allowed_subtree")
        if not candidate.is_dir() or candidate.is_symlink():
            raise ValueError("invalid_allowed_subtree")
        allowed.append(candidate)
    if not allowed:
        raise ValueError("missing_allowed_subtree")

    entries: list[tuple[Path, os.stat_result, str]] = []
    pending = [root]
    while pending:
        current = pending.pop()
        current_st = os.lstat(current)
        if not stat.S_ISDIR(current_st.st_mode):
            raise ValueError("unsafe_type")
        with os.scandir(current) as scan:
            children = sorted(scan, key=lambda item: item.name)
        for item in children:
            path = Path(item.path)
            rel = _rel(path, root)
            st = os.lstat(path)
            if not stat.S_ISLNK(st.st_mode) and not _inside(path, root):
                raise ValueError("path_escape")
            if stat.S_ISDIR(st.st_mode):
                entries.append((path, st, "directory"))
                pending.append(path)
            elif stat.S_ISREG(st.st_mode):
                if st.st_nlink != 1:
                    raise ValueError("hardlink_rejected")
                entries.append((path, st, "regular"))
            elif stat.S_ISLNK(st.st_mode):
                target = os.readlink(path)
                resolved = (path.parent / target).resolve(strict=False)
                if not _interpreter_link(rel) and not _inside(resolved, root):
                    raise ValueError("symlink_escape")
                if _interpreter_link(rel):
                    target_st = os.stat(path)
                    if not stat.S_ISREG(target_st.st_mode) or not (target_st.st_mode & 0o111):
                        raise ValueError("unsafe_interpreter_link")
                entries.append((path, st, "symlink"))
            else:
                raise ValueError("unsafe_type")

    def is_allowed(path: Path) -> bool:
        return any(_inside(path, subtree) or path == subtree for subtree in allowed)

    if any(kind != "symlink" and not is_allowed(path) for path, _, kind in entries):
        raise ValueError("path_outside_allowed_subtree")

    # All validation is complete: only now change ownership and mode.
    for path, st, kind in entries:
        if kind == "symlink":
            continue
        os.chown(path, 0, expected_gid, follow_symlinks=False)
        if kind == "directory":
            os.chmod(path, 0o2750 if (st.st_mode & stat.S_ISGID) else 0o750, follow_symlinks=False)
        else:
            mode = 0o750 if (st.st_mode & 0o111) else 0o640
            os.chmod(path, mode, follow_symlinks=False)

    # Root itself is part of the staging boundary and must be safe too.
    root_st = os.lstat(root)
    if not stat.S_ISDIR(root_st.st_mode):
        raise ValueError("unsafe_staging_root")
    os.chown(root, 0, expected_gid, follow_symlinks=False)
    os.chmod(root, 0o2750 if (root_st.st_mode & stat.S_ISGID) else 0o750, follow_symlinks=False)
    return [_inventory_entry(path, root, expected_gid) for path, _, _ in [(root, root_st, "directory"), *entries]]


def prepare_staging(root: str, directories: tuple[str, ...] = (), files: tuple[str, ...] = ()) -> None:
    """Compatibility wrapper for the legacy explicit-target test surface."""
    base = _canonical_root(root)
    for rel in directories:
        path = base / rel
        st = os.lstat(path)
        if path.is_symlink() or not _inside(path, base) or not stat.S_ISDIR(st.st_mode):
            raise ValueError("unsafe_mutation_target")
        os.chmod(path, 0o750, follow_symlinks=False)
    for rel in files:
        path = base / rel
        st = os.lstat(path)
        if path.is_symlink() or not _inside(path, base) or not stat.S_ISREG(st.st_mode) or st.st_nlink != 1:
            raise ValueError("unsafe_mutation_target")
        if _interpreter_link(rel):
            raise ValueError("interpreter_mutation_forbidden")
        os.chmod(path, 0o640, follow_symlinks=False)


def verify_no_follow(root: str) -> list[str]:
    base = _canonical_root(root)
    return [str(entry["path"]) for entry in normalize_staging_runtime(base, 0, os.getgid(), (".",))]
