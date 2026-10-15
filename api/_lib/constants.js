// CommonJS copy of js/constants.js for the serverless SSR functions.
// Deliberately duplicated rather than shared: the browser needs ES-module
// `export`s and the functions need CommonJS `require`, and Vercel only
// reliably bundles files reached by a static `require` from a function. If
// you edit the map/type/label lists here, mirror the change in
// js/constants.js (and vice-versa) — they must stay in sync.
const MAPS = [
  { id: "dust2",    name: "Dust II"   },
  { id: "mirage",   name: "Mirage"    },
  { id: "inferno",  name: "Inferno"   },
  { id: "nuke",     name: "Nuke"      },
  { id: "ancient",  name: "Ancient"   },
  { id: "anubis",   name: "Anubis"    },
  { id: "vertigo",  name: "Vertigo"   },
  { id: "cache",    name: "Cache"     },
  { id: "overpass", name: "Overpass"  },
];

const TYPES = [
  { id: "smoke", label: "Smoke"     },
  { id: "flash", label: "Flash"     },
  { id: "fire",  label: "Molotov"   },
  { id: "he",    label: "HE Grenade"},
  { id: "decoy", label: "Decoy"     },
];

const RANGE_LABELS = {
  "throw": "Throw",
  "mid-throw": "Mid-throw",
  "close-throw": "Close-throw",
};

const MOVEMENT_LABELS = {
  "none":                  "Standing",
  "jumpthrow":             "Jumpthrow",
  "w-throw":               "W + Throw",
  "w-jumpthrow":           "W + Jumpthrow",
  "walk-throw":            "Walk + Throw",
  "walk-jumpthrow":        "Walk + Jumpthrow",
  "run-throw":             "Run + Throw",
  "run-jumpthrow":         "Run + Jumpthrow",
  "crouch-throw":          "Crouch + Throw",
  "crouchjump":            "Crouch + Jumpthrow",
  "crouch-walk-throw":     "Crouch Walk + Throw",
  "crouch-walk-jumpthrow": "Crouch Walk + Jumpthrow",
  // Legacy values kept so previously saved throws still show a label.
  "run":                   "Run",
  "shift-w-throw":         "Shift + W + Throw",
  "shift-w-jumpthrow":     "Shift + W + Jumpthrow",
  "crouch":                "Crouch",
  "crouchaim-jump":        "Crouch-aim + Jumpthrow",
  "crouchaim-crouchjump":  "Crouch-aim + Crouch-Jumpthrow",
};

module.exports = { MAPS, TYPES, RANGE_LABELS, MOVEMENT_LABELS };
