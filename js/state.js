import { MAPS, TYPES } from "./constants.js";

// Which marks the map shows, remembered across maps and visits (js/markers.js).
export const MARK_MODES = ["landing", "throws", "both"];
export const MARK_MODE_KEY = "lineupr.markMode";
function savedMarkMode() {
  try {
    const v = localStorage.getItem(MARK_MODE_KEY);
    return MARK_MODES.includes(v) ? v : "landing";
  } catch { return "landing"; }
}

export let state = {
  mapId: MAPS[0].id,
  levelId: "top",        // active radar level id for maps with a `levels` list (e.g. Nuke, Vertigo)
  viewMode: "official",  // "official" (public map) or "personal" (signed-in user's own map)
  lineups: [],          // all lineups for current map + view, loaded from DB
  lineupsLoading: false, // true while the current map's lineups are being fetched
  lineupsError: false,   // true when the last lineup load failed (the list offers a retry)
  lineupsUserId: undefined, // auth user id (or null) the last lineup load ran for; undefined before any load
  savedThrowKeys: new Set(), // `${lineupId}::${throwId}` for every individual throw position the user has bookmarked
  activeFilters: new Set(TYPES.map(t => t.id)),
  sideFilter: "all",     // "all" | "t" | "ct" (lineups with side "any" always pass)
  markMode: savedMarkMode(), // "landing" | "throws" | "both": landing spots, throw spots, or both on the map
  collectionView: null,  // { id } while a collection is open (js/collections.js owns state.lineups then)
  areas: [],             // map_areas rows for the current map (see js/areas.js)
  areaFilter: null,      // slug of the selected map area, or null
  pendingSide: "any",
  pendingType: null,
  pendingName: "",     // type chosen in type modal, awaiting landing click
  pendingLanding: null,  // {x,y} percent, awaiting throw-pos click for a NEW lineup
  pendingThrowFor: null, // lineup id awaiting a throw-pos click (adding to existing lineup)
  selectedLineupId: null,
  addMode: false,
  openClusterKey: null,  // key of a stacked marker currently fanned open on the map
  reposition: false,     // true while the drag-to-reposition-a-throw overlay is active
};

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
