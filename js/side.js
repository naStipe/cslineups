// T / CT side of a lineup. Stored per lineup as "t" | "ct" | "any" (the
// default: official lineups predate the field, and many nades work from
// either side). The map filter treats "any" lineups as matching both sides.
export const SIDES = [
  { id: "any", label: "Any" },
  { id: "t",   label: "T" },
  { id: "ct",  label: "CT" },
];

export const SIDE_FILTERS = [
  { id: "all", label: "All" },
  { id: "t",   label: "T" },
  { id: "ct",  label: "CT" },
];

export function normalizeSide(v) {
  return v === "t" || v === "ct" ? v : "any";
}

export function sideLabel(v) {
  const s = SIDES.find(x => x.id === normalizeSide(v));
  return s ? s.label : "Any";
}

// Does a lineup pass the active side filter ("all" | "t" | "ct")?
export function passesSide(lineup, filter) {
  if (!filter || filter === "all") return true;
  const side = normalizeSide(lineup.side);
  return side === "any" || side === filter;
}

// Small segmented radio control, used by the create dialog, the dossier and
// the filter bars. `options` is SIDES or SIDE_FILTERS; onChange gets the id.
export function sideSegment(options, value, onChange, { label = "Side", disabled = false } = {}) {
  const wrap = document.createElement("div");
  wrap.className = "side-seg";
  wrap.setAttribute("role", "radiogroup");
  wrap.setAttribute("aria-label", label);
  options.forEach(o => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "side-seg-btn" + (o.id === value ? " active" : "");
    b.dataset.side = o.id;
    b.setAttribute("role", "radio");
    b.setAttribute("aria-checked", o.id === value ? "true" : "false");
    b.textContent = o.label;
    b.disabled = disabled;
    b.onclick = () => {
      if (o.id === value) return;
      value = o.id;
      wrap.querySelectorAll(".side-seg-btn").forEach(x => {
        const on = x.dataset.side === value;
        x.classList.toggle("active", on);
        x.setAttribute("aria-checked", on ? "true" : "false");
      });
      onChange(value);
    };
    wrap.appendChild(b);
  });
  return wrap;
}
