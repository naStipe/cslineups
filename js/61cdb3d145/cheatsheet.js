import { MAPS } from "./constants.js";
import { cheatsheetClose, cheatsheetImg, cheatsheetPanel, cheatsheetSubtabs, cheatsheetTabs, cheatsheetTitle } from "./dom.js";
import { openLightbox } from "./lightbox.js";

const CS_ICON = `<svg class="cs-icon" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg">
  <circle cx="7"  cy="13" r="4.5" stroke="currentColor" stroke-width="1.5"/>
  <circle cx="13" cy="11" r="4"   stroke="currentColor" stroke-width="1.5"/>
  <circle cx="10" cy="7"  r="3.5" stroke="currentColor" stroke-width="1.5"/>
  <line x1="10" y1="17" x2="10" y2="20" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
  <line x1="7"  y1="20" x2="13" y2="20" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
</svg>`;

// Current map's cheatsheet entries ({ label, file }[]) and which one is open.
let entries = [];
let activeIdx = 0;

export function updateCheatsheet(mapId) {
  const m = MAPS.find(x => x.id === mapId);
  entries = (m && Array.isArray(m.cheatsheet)) ? m.cheatsheet : [];
  activeIdx = 0;
  cheatsheetPanel.classList.remove("open");

  if (!entries.length) {
    cheatsheetPanel.classList.add("hidden");
    cheatsheetTabs.innerHTML = "";
    return;
  }
  cheatsheetPanel.classList.remove("hidden");
  renderTabs();
}

// Launcher buttons — one per entry — shown when the panel is closed.
function renderTabs() {
  cheatsheetTabs.innerHTML = "";
  entries.forEach((entry, i) => {
    const btn = document.createElement("button");
    btn.className = "cheatsheet-tab";
    btn.innerHTML = `${CS_ICON}${entry.label}`;
    btn.onclick = () => openEntry(i);
    cheatsheetTabs.appendChild(btn);
  });
}

// Sub-tab pills inside the open panel's header, for switching entries
// without closing the panel. Only rendered when there's more than one.
function renderSubtabs() {
  cheatsheetSubtabs.innerHTML = "";
  if (entries.length < 2) return;
  entries.forEach((entry, i) => {
    const btn = document.createElement("button");
    btn.className = "cheatsheet-subtab" + (i === activeIdx ? " active" : "");
    btn.textContent = entry.label;
    btn.onclick = () => openEntry(i);
    cheatsheetSubtabs.appendChild(btn);
  });
}

function openEntry(i) {
  activeIdx = i;
  const entry = entries[i];
  if (!entry) return;
  cheatsheetImg.src = entry.file;
  cheatsheetTitle.textContent = entry.label;
  renderSubtabs();
  cheatsheetPanel.classList.add("open");
}

cheatsheetClose.onclick = () => cheatsheetPanel.classList.remove("open");

cheatsheetImg.onclick = () => {
  const entry = entries[activeIdx];
  if (entry) openLightbox([entry.file], 0, entry.label);
};
