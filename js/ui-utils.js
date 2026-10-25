// Small shared UI helpers: button busy state and the empty-state block.

// setBusy(button, true, "Saving…") disables the button and swaps its content
// for a small spinner + label, pinning the current width so the layout doesn't
// jump; setBusy(button, false) puts the original content back. Safe to call
// twice in a row with the same state.
export function setBusy(button, busy, label) {
  if (!button) return;
  if (busy) {
    if (button.dataset.busy === "1") {
      if (label) button.querySelector(".busy-label").textContent = label;
      return;
    }
    button.dataset.busy = "1";
    button._busyRestore = { html: button.innerHTML, minWidth: button.style.minWidth, disabled: button.disabled };
    button.style.minWidth = button.offsetWidth + "px";
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    button.innerHTML = `<span class="busy-spinner" aria-hidden="true"></span><span class="busy-label"></span>`;
    button.querySelector(".busy-label").textContent = label || button.textContent || "Working…";
    button.classList.add("is-busy");
  } else {
    if (button.dataset.busy !== "1") return;
    const r = button._busyRestore || {};
    button.innerHTML = r.html || "";
    button.style.minWidth = r.minWidth || "";
    button.disabled = !!r.disabled;
    button.removeAttribute("aria-busy");
    button.classList.remove("is-busy");
    delete button.dataset.busy;
    delete button._busyRestore;
  }
}

// Builds a centred empty-state block: a title, a short explanation and an
// optional action button. Returns the element (callers append it).
//   emptyState({ title: "No smokes match your filters", body: "…",
//                action: { label: "Clear filters", onClick } , compact: true })
export function emptyState({ title, body, action, compact = false } = {}) {
  const el = document.createElement("div");
  el.className = "empty-state" + (compact ? " compact" : "");
  if (title) {
    const t = document.createElement("p");
    t.className = "empty-state-title";
    t.textContent = title;
    el.appendChild(t);
  }
  if (body) {
    const b = document.createElement("p");
    b.className = "empty-state-body";
    b.textContent = body;
    el.appendChild(b);
  }
  if (action && action.label) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ghost-btn empty-state-action";
    btn.textContent = action.label;
    btn.onclick = action.onClick;
    el.appendChild(btn);
  }
  return el;
}
