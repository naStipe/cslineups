// Toasts: short, non-blocking status messages ("Link copied", "Deleted ·
// Undo"). They replace alert() for errors and confirmations that don't need
// an answer. At most MAX_VISIBLE stack bottom-centre (above the FAB / bottom
// sheet on mobile, see .toast-host in style.css); a newer toast pushes the
// oldest out. The host is an aria-live region, so screen readers announce
// each message without moving focus.
//
// Standalone on purpose (no app imports) so admin.html can use it too.

const MAX_VISIBLE = 3;
const DEFAULT_DURATION = 4000;
const LEAVE_MS = 200; // matches the .toast.out transition

let host = null;
const live = []; // newest last

function ensureHost() {
  if (host && host.isConnected) return host;
  host = document.createElement("div");
  host.className = "toast-host";
  host.setAttribute("role", "status");
  host.setAttribute("aria-live", "polite");
  document.body.appendChild(host);
  return host;
}

// toast(message, { action: { label, onClick }, duration, tone })
//   tone: "error" tints the toast for failures; anything else is neutral.
//   duration: ms before it auto-dismisses (0 = stays until dismissed).
// Returns { dismiss } so callers can take a toast down early.
export function toast(message, { action, duration = DEFAULT_DURATION, tone } = {}) {
  ensureHost();
  const el = document.createElement("div");
  el.className = "toast" + (tone === "error" ? " toast-error" : "");

  const text = document.createElement("span");
  text.className = "toast-text";
  text.textContent = message;
  el.appendChild(text);

  let timer = null;
  let remaining = duration;
  let startedAt = 0;
  let gone = false;

  const dismiss = () => {
    if (gone) return;
    gone = true;
    clearTimeout(timer);
    const i = live.indexOf(entry);
    if (i !== -1) live.splice(i, 1);
    el.classList.add("out");
    setTimeout(() => el.remove(), LEAVE_MS);
  };

  if (action && action.label) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "toast-action";
    btn.textContent = action.label;
    btn.onclick = () => {
      dismiss();
      try { action.onClick && action.onClick(); } catch (err) { console.error(err); }
    };
    el.appendChild(btn);
  }

  const close = document.createElement("button");
  close.type = "button";
  close.className = "toast-close";
  close.setAttribute("aria-label", "Dismiss");
  close.textContent = "✕";
  close.onclick = dismiss;
  el.appendChild(close);

  // Pause the countdown while the pointer or keyboard focus is on the toast,
  // so an "Undo" never vanishes from under someone reaching for it.
  const start = () => {
    if (!duration || gone) return;
    startedAt = Date.now();
    clearTimeout(timer);
    timer = setTimeout(dismiss, remaining);
  };
  const pause = () => {
    if (!duration || gone) return;
    clearTimeout(timer);
    remaining = Math.max(800, remaining - (Date.now() - startedAt));
  };
  el.addEventListener("mouseenter", pause);
  el.addEventListener("mouseleave", start);
  el.addEventListener("focusin", pause);
  el.addEventListener("focusout", start);

  const entry = { el, dismiss };
  live.push(entry);
  while (live.length > MAX_VISIBLE) live[0].dismiss();
  host.appendChild(el);
  start();
  return { dismiss };
}

// Shorthand for failures — the common replacement for alert(err.message).
export function toastError(message, opts = {}) {
  return toast(message, { duration: 6000, ...opts, tone: "error" });
}
