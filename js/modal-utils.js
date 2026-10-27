export function closeModal(m) { m.classList.remove("show"); }

// Focus management for dialogs. Each watched dialog is shown/hidden by a CSS
// class ("show" / "open") toggled from many places (close buttons, backdrop
// clicks, the global Escape handler), so instead of hooking every one of
// those, a MutationObserver reacts to the class change: on open it remembers
// the opener and moves focus inside; while open, Tab is trapped in the top
// dialog; on close, focus goes back to the opener.
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const openStack = []; // [{ el, opener }], top of stack = last

// The map stage cancels mousedown (for panning), so clicking a marker never
// focuses it; remember the last focusable thing pressed as the fallback opener.
let lastPressed = null;
document.addEventListener("pointerdown", (e) => {
  lastPressed = e.target.closest ? e.target.closest(FOCUSABLE) : null;
}, true);

function focusables(el) {
  return [...el.querySelectorAll(FOCUSABLE)].filter(n => n.getClientRects().length && !n.closest("[hidden]"));
}

// `fallbackFocus` (optional) names where focus goes on close when the opener
// no longer exists, e.g. a map marker that was re-rendered away.
export function watchDialog(el, openClass, initialFocus, fallbackFocus) {
  let wasOpen = el.classList.contains(openClass);
  new MutationObserver(() => {
    const isOpen = el.classList.contains(openClass);
    if (isOpen === wasOpen) return;
    wasOpen = isOpen;
    if (isOpen) {
      const active = document.activeElement;
      const opener = active && active !== document.body ? active : lastPressed;
      openStack.push({ el, opener: opener && !el.contains(opener) ? opener : null });
      // Observer callbacks run after the class change, and focus() forces the
      // style update, so the now-displayed dialog can take focus right away.
      const target = (initialFocus && initialFocus()) || focusables(el)[0] || el;
      if (target === el && !el.hasAttribute("tabindex")) el.setAttribute("tabindex", "-1");
      target.focus({ preventScroll: true });
    } else {
      const i = openStack.findIndex(d => d.el === el);
      if (i === -1) return;
      const [{ opener }] = openStack.splice(i, 1);
      // Only restore if focus was inside the dialog (or lost to <body>) —
      // never steal it from something the user has since moved to.
      const a = document.activeElement;
      if (a && a !== document.body && !el.contains(a)) return;
      const fallback = !(opener && opener.isConnected) && fallbackFocus ? fallbackFocus() : null;
      if (opener && opener.isConnected && opener.getClientRects().length) opener.focus({ preventScroll: true });
      else if (fallback) fallback.focus({ preventScroll: true });
      else if (a && el.contains(a)) a.blur(); // don't leave focus inside a hidden dialog
    }
  }).observe(el, { attributes: true, attributeFilter: ["class"] });
}

document.addEventListener("keydown", (e) => {
  if (e.key !== "Tab" || !openStack.length) return;
  const { el } = openStack[openStack.length - 1];
  const items = focusables(el);
  if (!items.length) { e.preventDefault(); return; }
  const first = items[0], last = items[items.length - 1];
  if (!el.contains(document.activeElement)) { e.preventDefault(); first.focus(); return; }
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
});
