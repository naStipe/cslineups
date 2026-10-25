// Relative timestamps ("just now", "3 days ago") with the full date kept in a
// tooltip. Lineup createdAt values are epoch milliseconds.

const rtf = typeof Intl !== "undefined" && Intl.RelativeTimeFormat
  ? new Intl.RelativeTimeFormat("en", { numeric: "auto" })
  : null;

const UNITS = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
];

export function relativeTime(ms, now = Date.now()) {
  const t = typeof ms === "number" ? ms : Date.parse(ms);
  if (!Number.isFinite(t) || t <= 0) return "";
  const diff = Math.round((t - now) / 1000); // negative = past
  if (Math.abs(diff) < 45) return "just now";
  for (const [unit, secs] of UNITS) {
    if (Math.abs(diff) >= secs || unit === "minute") {
      const value = Math.round(diff / secs);
      if (rtf) return rtf.format(value, unit);
      const n = Math.abs(value);
      return `${n} ${unit}${n === 1 ? "" : "s"} ${value < 0 ? "ago" : "from now"}`;
    }
  }
  return "";
}

export function fullDate(ms) {
  const t = typeof ms === "number" ? ms : Date.parse(ms);
  if (!Number.isFinite(t) || t <= 0) return "";
  return new Date(t).toLocaleString(undefined, { dateStyle: "long", timeStyle: "short" });
}

// <time> element showing the relative time, full date on hover. `prefix`
// (e.g. "added ") is prepended to the visible text only.
export function timeEl(ms, prefix = "") {
  const el = document.createElement("time");
  const t = typeof ms === "number" ? ms : Date.parse(ms);
  if (!Number.isFinite(t) || t <= 0) return el;
  el.dateTime = new Date(t).toISOString();
  el.title = fullDate(t);
  el.textContent = prefix + relativeTime(t);
  return el;
}
