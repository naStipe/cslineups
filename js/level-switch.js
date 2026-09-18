import { MAPS } from "./constants.js";
import { levelToggle, mapImage } from "./dom.js";
import { state } from "./state.js";

// Builds (or hides) the upper/lower radar switch for the current map and
// resets to the top level. Call whenever the selected map changes.
export function updateLevelSwitch(mapId) {
  const m = MAPS.find(x => x.id === mapId);
  const levels = m && Array.isArray(m.levels) ? m.levels : [];
  state.levelId = levels[0] ? levels[0].id : "top";

  levelToggle.innerHTML = "";
  if (levels.length < 2) {
    levelToggle.classList.add("hidden");
    return;
  }

  levelToggle.classList.remove("hidden");
  levels.forEach(level => {
    const btn = document.createElement("button");
    btn.className = "view-toggle-btn" + (level.id === state.levelId ? " active" : "");
    btn.textContent = level.label;
    btn.onclick = () => setLevel(mapId, level.id);
    levelToggle.appendChild(btn);
  });
}

function setLevel(mapId, levelId) {
  const m = MAPS.find(x => x.id === mapId);
  const level = m.levels.find(l => l.id === levelId);
  if (!level) return;
  state.levelId = levelId;
  mapImage.src = level.file;
  levelToggle.querySelectorAll(".view-toggle-btn").forEach((btn, i) => {
    btn.classList.toggle("active", m.levels[i].id === levelId);
  });
}
