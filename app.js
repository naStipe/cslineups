/* ===================== CONFIG ===================== */

const MAPS = [
  { id: "dust2",   name: "Dust II",  file: "maps/dust2.webp"  },
  { id: "mirage",  name: "Mirage",   file: "maps/mirage.webp" },
  { id: "inferno", name: "Inferno",  file: "maps/inferno.webp"},
  { id: "nuke",    name: "Nuke",     file: "maps/nuke.webp"   },
  { id: "ancient", name: "Ancient",  file: "maps/ancient.webp"},
  { id: "anubis",  name: "Anubis",   file: "maps/anubis.png"  },
  { id: "cache",   name: "Cache",    file: "maps/cache.webp"  },
];

const TYPES = [
  { id: "smoke", label: "Smoke",     color: "var(--smoke)" },
  { id: "flash", label: "Flash",     color: "var(--flash)" },
  { id: "fire",  label: "Molotov",   color: "var(--fire)"  },
  { id: "he",    label: "HE Grenade",color: "var(--he)"    },
  { id: "decoy", label: "Decoy",     color: "var(--decoy)" },
];

/* ===================== STORAGE (IndexedDB) ===================== */

const DB_NAME = "lineups-db";
const STORE = "lineups";
let dbPromise = null;

function getDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("mapId", "mapId", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function dbGetAll() {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbPut(record) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function dbDelete(id) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function dbClearMap(mapId) {
  const all = await dbGetAll();
  const toDelete = all.filter(l => l.mapId === mapId);
  for (const l of toDelete) await dbDelete(l.id);
}

/* ===================== STATE ===================== */

let state = {
  mapId: MAPS[0].id,
  lineups: [],          // all lineups for current map, loaded from DB
  activeFilters: new Set(TYPES.map(t => t.id)),
  pendingType: null,     // type chosen in type modal, awaiting landing click
  pendingLanding: null,  // {x,y} percent, awaiting throw-pos click for a NEW lineup
  pendingThrowFor: null, // lineup id awaiting a throw-pos click (adding to existing lineup)
  selectedLineupId: null,
  addMode: false,
};

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/* ===================== DOM REFS ===================== */

const mapList = document.getElementById("mapList");
const typeFilters = document.getElementById("typeFilters");
const mapImage = document.getElementById("mapImage");
const mapFrame = document.getElementById("mapFrame");
const markerLayer = document.getElementById("markerLayer");
const linkSvg = document.getElementById("linkSvg");
const currentMapName = document.getElementById("currentMapName");
const lineupCount = document.getElementById("lineupCount");
const addModeBtn = document.getElementById("addModeBtn");
const addHint = document.getElementById("addHint");

const typeModal = document.getElementById("typeModal");
const typeGrid = document.getElementById("typeGrid");
const cancelType = document.getElementById("cancelType");

const throwModal = document.getElementById("throwModal");
const throwModalTitle = document.getElementById("throwModalTitle");
const screenshotInput = document.getElementById("screenshotInput");
const screenshotPreview = document.getElementById("screenshotPreview");
const throwTypeSelect = document.getElementById("throwTypeSelect");
const keybindInput = document.getElementById("keybindInput");
const notesInput = document.getElementById("notesInput");
const cancelThrow = document.getElementById("cancelThrow");
const saveThrow = document.getElementById("saveThrow");

const detailPanel = document.getElementById("detailPanel");
const detailType = document.getElementById("detailType");
const detailTitle = document.getElementById("detailTitle");
const throwList = document.getElementById("throwList");
const closeDetail = document.getElementById("closeDetail");
const addThrowBtn = document.getElementById("addThrowBtn");
const deleteLineupBtn = document.getElementById("deleteLineupBtn");

const exportBtn = document.getElementById("exportBtn");
const importInput = document.getElementById("importInput");
const clearBtn = document.getElementById("clearBtn");

let pendingThrowDraft = null; // {x,y,screenshot,...} being built before save

/* ===================== INIT ===================== */

function buildSidebar() {
  mapList.innerHTML = "";
  MAPS.forEach(m => {
    const el = document.createElement("div");
    el.className = "map-item" + (m.id === state.mapId ? " active" : "");
    el.innerHTML = `<span class="swatch"></span>${m.name}`;
    el.onclick = () => selectMap(m.id);
    mapList.appendChild(el);
  });
}

function buildFilters() {
  typeFilters.innerHTML = "";
  TYPES.forEach(t => {
    const chip = document.createElement("div");
    chip.className = "filter-chip";
    chip.innerHTML = `<span class="dot" style="background:${t.color}"></span>${t.label}`;
    chip.onclick = () => {
      if (state.activeFilters.has(t.id)) {
        state.activeFilters.delete(t.id);
        chip.classList.add("off");
      } else {
        state.activeFilters.add(t.id);
        chip.classList.remove("off");
      }
      renderMarkers();
    };
    typeFilters.appendChild(chip);
  });
}

function buildTypeGrid(onPick) {
  typeGrid.innerHTML = "";
  TYPES.forEach(t => {
    const opt = document.createElement("div");
    opt.className = "type-opt";
    opt.innerHTML = `<span class="dot" style="background:${t.color}"></span>${t.label}`;
    opt.onclick = () => onPick(t.id);
    typeGrid.appendChild(opt);
  });
}

async function selectMap(id) {
  state.mapId = id;
  state.selectedLineupId = null;
  detailPanel.classList.remove("open");
  setAddMode(false);
  buildSidebar();
  const m = MAPS.find(x => x.id === id);
  currentMapName.textContent = m.name.toUpperCase();
  mapImage.src = m.file;
  await loadLineups();
}

async function loadLineups() {
  const all = await dbGetAll();
  state.lineups = all.filter(l => l.mapId === state.mapId);
  lineupCount.textContent = `${state.lineups.length} lineup${state.lineups.length === 1 ? "" : "s"}`;
  renderMarkers();
}

/* ===================== ADD MODE / MAP CLICKS ===================== */

function setAddMode(on) {
  state.addMode = on;
  state.pendingType = null;
  state.pendingLanding = null;
  addModeBtn.classList.toggle("active", on);
  mapFrame.classList.toggle("add-mode", on);
  addHint.classList.toggle("show", on);
  if (on) addHint.textContent = "Click anywhere on the map to drop the landing spot for a new lineup.";
}

addModeBtn.onclick = () => setAddMode(!state.addMode);

mapFrame.addEventListener("click", (e) => {
  const rect = mapImage.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * 100;
  const y = ((e.clientY - rect.top) / rect.height) * 100;
  if (x < 0 || x > 100 || y < 0 || y > 100) return;

  if (state.pendingThrowFor) {
    openThrowModal({ x, y }, state.pendingThrowFor, false);
    return;
  }

  if (state.addMode) {
    if (!state.pendingType) {
      openTypeModal((typeId) => {
        state.pendingType = typeId;
        closeModal(typeModal);
        addHint.textContent = "Now click where this nade lands.";
      });
    } else if (!state.pendingLanding) {
      state.pendingLanding = { x, y };
      addHint.textContent = "Now click the spot you throw from.";
    } else {
      const newId = uid();
      openThrowModal({ x, y }, newId, true, state.pendingType, state.pendingLanding);
    }
  }
});

function openTypeModal(onPick) {
  buildTypeGrid(onPick);
  typeModal.classList.add("show");
}
cancelType.onclick = () => { closeModal(typeModal); setAddMode(false); };

function closeModal(m) { m.classList.remove("show"); }

/* ===================== THROW MODAL ===================== */

function openThrowModal(throwPos, lineupId, isNewLineup, typeId, landingPos) {
  pendingThrowDraft = { throwPos, lineupId, isNewLineup, typeId, landingPos, screenshot: null };
  screenshotInput.value = "";
  screenshotPreview.hidden = true;
  throwTypeSelect.value = "stand";
  keybindInput.value = "";
  notesInput.value = "";
  throwModalTitle.textContent = isNewLineup ? "New lineup — throw position" : "Add throw position";
  throwModal.classList.add("show");
}

screenshotInput.onchange = () => {
  const file = screenshotInput.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    pendingThrowDraft.screenshot = reader.result;
    screenshotPreview.src = reader.result;
    screenshotPreview.hidden = false;
  };
  reader.readAsDataURL(file);
};

cancelThrow.onclick = () => {
  closeModal(throwModal);
  pendingThrowDraft = null;
  setAddMode(false);
  state.pendingThrowFor = null;
};

saveThrow.onclick = async () => {
  if (!pendingThrowDraft) return;
  const draft = pendingThrowDraft;
  const throwEntry = {
    id: uid(),
    pos: draft.throwPos,
    screenshot: draft.screenshot,
    throwType: throwTypeSelect.value,
    keybind: keybindInput.value.trim(),
    notes: notesInput.value.trim(),
  };

  if (draft.isNewLineup) {
    const lineup = {
      id: draft.lineupId,
      mapId: state.mapId,
      type: draft.typeId,
      landing: draft.landingPos,
      throws: [throwEntry],
      createdAt: Date.now(),
    };
    await dbPut(lineup);
  } else {
    const lineup = state.lineups.find(l => l.id === draft.lineupId);
    lineup.throws.push(throwEntry);
    await dbPut(lineup);
  }

  closeModal(throwModal);
  pendingThrowDraft = null;
  setAddMode(false);
  const wasNew = draft.isNewLineup;
  const reopenId = draft.lineupId;
  state.pendingThrowFor = null;
  await loadLineups();
  openDetail(reopenId);
};

/* ===================== MARKERS / RENDERING ===================== */

function typeColor(typeId) {
  return TYPES.find(t => t.id === typeId)?.color || "#fff";
}

function getCssVarColor(v) {
  if (v.startsWith("var(")) {
    return getComputedStyle(document.documentElement).getPropertyValue(v.slice(4, -1)).trim();
  }
  return v;
}

function renderMarkers() {
  markerLayer.innerHTML = "";
  linkSvg.innerHTML = "";
  const visible = state.lineups.filter(l => state.activeFilters.has(l.type));

  visible.forEach(lineup => {
    const isOpen = state.selectedLineupId === lineup.id;

    const landing = document.createElement("div");
    landing.className = `marker landing ${lineup.type}`;
    landing.style.left = lineup.landing.x + "%";
    landing.style.top = lineup.landing.y + "%";
    landing.title = "Click to see throw position(s)";
    landing.onclick = (e) => { e.stopPropagation(); openDetail(lineup.id); };
    markerLayer.appendChild(landing);

    if (isOpen) {
      lineup.throws.forEach(t => {
        const tp = document.createElement("div");
        tp.className = `marker throwpos ${lineup.type}`;
        tp.style.left = t.pos.x + "%";
        tp.style.top = t.pos.y + "%";
        tp.title = "Throw from here";
        markerLayer.appendChild(tp);

        const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
        line.setAttribute("x1", t.pos.x + "%");
        line.setAttribute("y1", t.pos.y + "%");
        line.setAttribute("x2", lineup.landing.x + "%");
        line.setAttribute("y2", lineup.landing.y + "%");
        line.setAttribute("stroke", getCssVarColor(typeColor(lineup.type)));
        line.setAttribute("class", "link-line");
        linkSvg.appendChild(line);
      });
    }
  });
}

/* ===================== DETAIL PANEL ===================== */

function openDetail(lineupId) {
  state.selectedLineupId = lineupId;
  const lineup = state.lineups.find(l => l.id === lineupId);
  if (!lineup) return;

  const typeInfo = TYPES.find(t => t.id === lineup.type);
  detailType.textContent = typeInfo.label;
  detailType.style.color = "#0a0d0e";
  detailType.style.background = getCssVarColor(typeInfo.color);
  detailTitle.textContent = `${typeInfo.label} lineup · ${lineup.throws.length} position${lineup.throws.length === 1 ? "" : "s"}`;

  throwList.innerHTML = "";
  lineup.throws.forEach(t => {
    const card = document.createElement("div");
    card.className = "throw-card";
    card.innerHTML = `
      ${t.screenshot ? `<img src="${t.screenshot}" alt="throw spot">` : ""}
      <div class="throw-card-body">
        <div class="throw-meta">
          <span class="tag">${t.throwType}</span>
          ${t.keybind ? `<span class="tag">${escapeHtml(t.keybind)}</span>` : ""}
        </div>
        ${t.notes ? `<div class="throw-notes">${escapeHtml(t.notes)}</div>` : ""}
        <div class="throw-card-actions"><button data-id="${t.id}">Remove</button></div>
      </div>
    `;
    card.querySelector(".throw-card-actions button").onclick = async () => {
      lineup.throws = lineup.throws.filter(x => x.id !== t.id);
      if (lineup.throws.length === 0) {
        await dbDelete(lineup.id);
        closeDetailPanel();
      } else {
        await dbPut(lineup);
      }
      await loadLineups();
      if (state.selectedLineupId) openDetail(state.selectedLineupId);
    };
    throwList.appendChild(card);
  });

  detailPanel.classList.add("open");
  renderMarkers();
}

function closeDetailPanel() {
  state.selectedLineupId = null;
  detailPanel.classList.remove("open");
  renderMarkers();
}
closeDetail.onclick = closeDetailPanel;

addThrowBtn.onclick = () => {
  state.pendingThrowFor = state.selectedLineupId;
  setAddMode(true);
  addHint.textContent = "Click the spot you throw from.";
  detailPanel.classList.remove("open");
};

deleteLineupBtn.onclick = async () => {
  if (!state.selectedLineupId) return;
  if (!confirm("Delete this entire lineup, including all throw positions?")) return;
  await dbDelete(state.selectedLineupId);
  closeDetailPanel();
  await loadLineups();
};

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

/* ===================== EXPORT / IMPORT / CLEAR ===================== */

exportBtn.onclick = async () => {
  const all = await dbGetAll();
  const blob = new Blob([JSON.stringify(all, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "lineups-backup.json";
  a.click();
  URL.revokeObjectURL(url);
};

importInput.onchange = async () => {
  const file = importInput.files[0];
  if (!file) return;
  const text = await file.text();
  try {
    const records = JSON.parse(text);
    for (const r of records) await dbPut(r);
    await loadLineups();
    alert(`Imported ${records.length} lineups.`);
  } catch (err) {
    alert("Could not read that file as a lineups backup.");
  }
  importInput.value = "";
};

clearBtn.onclick = async () => {
  if (!confirm(`Delete ALL lineups on ${MAPS.find(m => m.id === state.mapId).name}?`)) return;
  await dbClearMap(state.mapId);
  closeDetailPanel();
  await loadLineups();
};

/* ===================== BOOT ===================== */

buildSidebar();
buildFilters();
selectMap(state.mapId);
