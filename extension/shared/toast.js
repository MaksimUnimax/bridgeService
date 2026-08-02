(() => {
  "use strict";

  const ROOT_ID = "business-bridge-2-status";
  const TONES = Object.freeze({
    cli_work: "#1d4ed8",
    operator_work: "#c2410c",
    operator_success: "#166534",
    error: "#991b1b"
  });

  const LEGACY_TONE_MAP = Object.freeze({
    neutral: "operator_work",
    active: "operator_work",
    success: "operator_success",
    warning: "operator_work",
    error: "error"
  });

  function normalizedTone(tone) {
    const value = String(tone || "operator_work");
    return TONES[value] ? value : (LEGACY_TONE_MAP[value] || "operator_work");
  }

  function ensureRoot() {
    let root = document.getElementById(ROOT_ID);
    if (root) return root;

    root = document.createElement("div");
    root.id = ROOT_ID;
    root.setAttribute("role", "status");
    root.setAttribute("aria-live", "polite");
    root.style.cssText = [
      "position:fixed", "top:18px", "right:18px", "z-index:2147483647",
      "display:none", "align-items:flex-start", "gap:10px", "max-width:520px",
      "padding:10px 10px 10px 12px", "border-radius:10px",
      "font:13px/1.4 system-ui,-apple-system,Segoe UI,sans-serif", "color:white",
      "background:#c2410c", "box-shadow:0 10px 30px rgba(0,0,0,.3)"
    ].join(";");

    const text = document.createElement("span");
    text.dataset.bb2ToastText = "true";
    text.style.cssText = "min-width:0;overflow-wrap:anywhere;";

    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "×";
    close.setAttribute("aria-label", "Закрыть уведомление");
    close.title = "Закрыть";
    close.style.cssText = [
      "flex:0 0 auto", "margin:-4px -2px 0 0", "padding:0", "width:24px", "height:24px",
      "border:0", "border-radius:6px", "background:transparent", "color:white",
      "font:700 20px/24px system-ui,-apple-system,Segoe UI,sans-serif", "cursor:pointer",
      "opacity:.9"
    ].join(";");
    close.addEventListener("mouseenter", () => { close.style.background = "rgba(255,255,255,.18)"; });
    close.addEventListener("mouseleave", () => { close.style.background = "transparent"; });
    close.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const toastId = root.dataset.toastId || null;
      root.style.display = "none";
      root.dispatchEvent(new CustomEvent("bb2-toast-dismissed", { detail: { toast_id: toastId } }));
    });

    root.append(text, close);
    document.documentElement.appendChild(root);
    return root;
  }

  function show({ text, tone = "operator_work", id = null } = {}) {
    const root = ensureRoot();
    const normalized = normalizedTone(tone);
    const textNode = root.querySelector("[data-bb2-toast-text]");
    if (textNode) textNode.textContent = String(text || "Business Bridge 2");
    root.dataset.toastTone = normalized;
    root.dataset.toastId = String(id || `${normalized}:${Date.now()}`);
    root.style.background = TONES[normalized];
    root.style.display = "flex";
    return { id: root.dataset.toastId, tone: normalized, color: TONES[normalized] };
  }

  function hide() {
    const root = document.getElementById(ROOT_ID);
    if (root) root.style.display = "none";
  }

  globalThis.BB2Toast = Object.freeze({ ROOT_ID, TONES, show, hide, normalizedTone, ensureRoot });
})();
