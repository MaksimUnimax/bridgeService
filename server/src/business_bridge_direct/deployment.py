"""Fail-closed permission preparation for Direct staging trees.

Traversal is verification-only and never follows links. Mutation targets are
explicit files/directories inside the staging root; venv interpreter links and
hardlinks are rejected.
"""
from __future__ import annotations
import os
from pathlib import Path


def _inside(path: Path, root: Path) -> bool:
    try: path.resolve(strict=False).relative_to(root.resolve(strict=True)); return True
    except ValueError: return False


def prepare_staging(root: str, directories: tuple[str, ...] = (), files: tuple[str, ...] = ()) -> None:
    base = Path(root)
    if base.is_symlink() or not base.is_dir(): raise ValueError("invalid_staging_root")
    for rel in directories:
        p = base / rel
        st = p.lstat()
        if p.is_symlink() or not _inside(p, base) or not p.is_dir(): raise ValueError("unsafe_mutation_target")
        os.chmod(p, 0o750, follow_symlinks=False)
    for rel in files:
        p = base / rel
        st = p.lstat()
        if p.is_symlink() or not _inside(p, base) or not p.is_file() or st.st_nlink > 1: raise ValueError("unsafe_mutation_target")
        if rel.startswith("venv/bin/python") or rel.startswith(".venv/bin/python"):
            raise ValueError("interpreter_mutation_forbidden")
        os.chmod(p, 0o640, follow_symlinks=False)


def verify_no_follow(root: str) -> list[str]:
    base = Path(root); found=[]
    for current, dirs, files in os.walk(base, topdown=True, followlinks=False):
        dirs[:] = [d for d in dirs if not (Path(current)/d).is_symlink()]
        for name in files:
            p=Path(current)/name
            if p.is_symlink(): continue
            if not _inside(p, base): raise ValueError("path_escape")
            found.append(str(p.relative_to(base)))
    return sorted(found)
