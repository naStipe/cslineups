// cheatsheet: an array of { label, file } instant-smoke reference images for
// this map, shown as one launcher button per entry (see js/cheatsheet.js).
// A single-entry array keeps the old un-named "Instant smokes" behavior;
// an empty array (or omitting the field) means no cheatsheet button at all.
//
// levels: for maps with more than one radar level (e.g. Nuke, Vertigo), an
// array of { id, label, file } entries. `file` is always the first (top)
// entry's image; the level switch (js/level-switch.js) swaps mapImage.src
// between them. Omit for single-level maps.
export const MAPS = [
  { id: "dust2",    name: "Dust II",   file: "maps/dust2.webp",         logo: "maps/dust2-logo.jpg",    cheatsheet: [] },
  { id: "mirage",   name: "Mirage",    file: "maps/mirage.webp",        logo: "maps/mirage-logo.jpg",   cheatsheet: [
    { label: "Window", file: "maps/mirage-insta-window.webp" },
    { label: "Top Mid", file: "maps/mirage-insta-topmid.webp" },
  ] },
  { id: "inferno",  name: "Inferno",   file: "maps/inferno.webp",       logo: "maps/inferno-logo.jpg",  cheatsheet: [
    { label: "Instant smokes", file: "maps/inferno-insta-smokes.webp" },
  ] },
  { id: "nuke",     name: "Nuke",      file: "maps/nuke-radar.png",     logo: "maps/nuke-logo.jpg",     cheatsheet: [], levels: [
    { id: "top",    label: "Upper", file: "maps/nuke-radar.png" },
    { id: "bottom", label: "Lower", file: "maps/nuke-radar-lower.png" },
  ] },
  { id: "ancient",  name: "Ancient",   file: "maps/ancient.webp",       logo: "maps/ancient-logo.jpg",  cheatsheet: [] },
  { id: "anubis",   name: "Anubis",    file: "maps/anubis.png",         logo: "maps/anubis-logo.jpg",   cheatsheet: [
    { label: "Instant smokes", file: "maps/anubis-insta-smokes.webp" },
  ] },
  { id: "vertigo",  name: "Vertigo",   file: "maps/vertigo-radar.png",  logo: "maps/vertigo-logo.jpg",  cheatsheet: [], levels: [
    { id: "top",    label: "Upper", file: "maps/vertigo-radar.png" },
    { id: "bottom", label: "Lower", file: "maps/vertigo-radar-lower.png" },
  ] },
  { id: "cache",    name: "Cache",     file: "maps/cache.webp",         logo: "maps/cache-logo.jpg",    cheatsheet: [] },
  // Not in the active map pool right now — kept last so it doesn't crowd the front of the grid.
  { id: "overpass", name: "Overpass",  file: "maps/overpass.webp",      logo: "maps/overpass-logo.jpg", cheatsheet: [] },
];

export const TYPES = [
  { id: "smoke", label: "Smoke",     color: "var(--smoke)" },
  { id: "flash", label: "Flash",     color: "var(--flash)" },
  { id: "fire",  label: "Molotov",   color: "var(--fire)"  },
  { id: "he",    label: "HE Grenade",color: "var(--he)"    },
  { id: "decoy", label: "Decoy",     color: "var(--decoy)" },
];

export const RANGE_LABELS = {
  "throw": "Throw",
  "mid-throw": "Mid-throw",
  "close-throw": "Close-throw",
};

export const MOVEMENT_LABELS = {
  "none":                  "Standing",
  "jumpthrow":             "Jumpthrow",
  "w-throw":               "W + Throw",
  "w-jumpthrow":           "W + Jumpthrow",
  "run":                   "Run",
  "run-throw":             "Run + Throw",
  "run-jumpthrow":         "Run + Jumpthrow",
  "shift-w-throw":         "Shift + W + Throw",
  "shift-w-jumpthrow":     "Shift + W + Jumpthrow",
  "crouch":                "Crouch",
  "crouchjump":            "Crouch + Jumpthrow",
  "crouchaim-jump":        "Crouch-aim + Jumpthrow",
  "crouchaim-crouchjump":  "Crouch-aim + Crouch-Jumpthrow",
};
