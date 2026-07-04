import { MAPS } from "./constants.js";
import { cheatsheetClose, cheatsheetImg, cheatsheetPanel, cheatsheetTab } from "./dom.js";
import { openLightbox } from "./lightbox.js";
import { state } from "./state.js";

export function updateCheatsheet(mapId) {
  const m = MAPS.find(x => x.id === mapId);
  if (m && m.cheatsheet) {
    cheatsheetImg.src = m.cheatsheet;
    cheatsheetPanel.classList.remove("hidden");
    cheatsheetPanel.classList.remove("open");
  } else {
    cheatsheetPanel.classList.add("hidden");
    cheatsheetPanel.classList.remove("open");
  }
}

cheatsheetTab.onclick = () => cheatsheetPanel.classList.add("open");

cheatsheetClose.onclick = () => cheatsheetPanel.classList.remove("open");

cheatsheetImg.onclick = () => {
  const m = MAPS.find(x => x.id === state.mapId);
  if (m && m.cheatsheet) openLightbox([m.cheatsheet], 0, "Instant Smokes");
};
