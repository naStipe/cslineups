// The one rule for "is this lineup shown on the map right now": type chips,
// T/CT side filter and the area filter. Search is separate (it only narrows
// the sidebar list, never the markers).
import { lineupInArea } from "./areas.js";
import { passesSide } from "./side.js";
import { state } from "./state.js";

export function lineupVisible(l) {
  return state.activeFilters.has(l.type) && passesSide(l, state.sideFilter) && lineupInArea(l, state.areaFilter);
}

// Everything except the type chips: used for the chip counts, so a hidden
// type still shows how many lineups it would bring back under the side/area filters.
export function passesNonTypeFilters(l) {
  return passesSide(l, state.sideFilter) && lineupInArea(l, state.areaFilter);
}
