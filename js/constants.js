export const MAPS = [
  { id: "dust2",    name: "Dust II",   file: "maps/dust2.webp",    logo: "maps/dust2-logo.jpg",    cheatsheet: null },
  { id: "mirage",   name: "Mirage",    file: "maps/mirage.webp",   logo: "maps/mirage-logo.jpg",   cheatsheet: "maps/mirage-insta-smokes.webp" },
  { id: "inferno",  name: "Inferno",   file: "maps/inferno.webp",  logo: "maps/inferno-logo.jpg",  cheatsheet: "maps/inferno-insta-smokes.webp" },
  { id: "nuke",     name: "Nuke",      file: "maps/nuke.webp",     logo: "maps/nuke-logo.jpg",     cheatsheet: null },
  { id: "ancient",  name: "Ancient",   file: "maps/ancient.webp",  logo: "maps/ancient-logo.jpg",  cheatsheet: null },
  { id: "anubis",   name: "Anubis",    file: "maps/anubis.png",    logo: "maps/anubis-logo.jpg",   cheatsheet: "maps/anubis-insta-smokes.webp" },
  { id: "overpass", name: "Overpass",  file: "maps/overpass.webp", logo: "maps/overpass-logo.jpg", cheatsheet: null },
  { id: "cache",    name: "Cache",     file: "maps/cache.webp",    logo: "maps/cache-logo.jpg",    cheatsheet: null },
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
