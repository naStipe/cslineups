/* ===================== EDIT LOCK ===================== */

const PW_STORAGE_KEY = "lineups-edit-password";

function getEditPassword() {
  return sessionStorage.getItem(PW_STORAGE_KEY) || "";
}
function setEditPassword(pw) {
  sessionStorage.setItem(PW_STORAGE_KEY, pw);
}
function isUnlocked() {
  return !!getEditPassword();
}
function lockEditing() {
  sessionStorage.removeItem(PW_STORAGE_KEY);
  applyLockState();
}
function applyLockState() {
  const unlocked = isUnlocked();
  document.body.classList.toggle("locked", !unlocked);
  lockBtn.textContent = unlocked ? "🔓 Editing unlocked" : "🔒 Unlock editing";
  lockBtn.classList.toggle("unlocked", unlocked);
}



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

const RANGE_LABELS = {
  "throw": "Throw",
  "mid-throw": "Mid-throw",
  "close-throw": "Close-throw",
};

const MOVEMENT_LABELS = {
  "none": "Standing",
  "jumpthrow": "Jumpthrow",
  "w-throw": "W + Throw",
  "w-jumpthrow": "W + Jumpthrow",
  "shift-w-throw": "Shift + W + Throw",
  "shift-w-jumpthrow": "Shift + W + Jumpthrow",
  "crouch": "Crouch",
  "crouchjump": "Crouch + Jump",
  "crouchaim-jump": "Crouch-aim + Jump",
  "crouchaim-crouchjump": "Crouch-aim + Crouch-jump",
};

/* ===================== STORAGE (Netlify Function API) ===================== */

const API_URL = "/.netlify/functions/lineups";

async function dbGetAll() {
  const res = await fetch(API_URL);
  if (!res.ok) {
    const msg = await res.text().catch(() => "");
    throw new Error(`Failed to load lineups (${res.status}): ${msg}`);
  }
  return res.json();
}

async function dbPut(record) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Edit-Password": getEditPassword() },
    body: JSON.stringify(record),
  });
  if (res.status === 401) throw new Error("LOCKED");
  if (!res.ok) {
    const msg = await res.text().catch(() => "");
    throw new Error(`Failed to save lineup (${res.status}): ${msg}`);
  }
}

async function dbDelete(id) {
  const res = await fetch(`${API_URL}?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { "X-Edit-Password": getEditPassword() },
  });
  if (res.status === 401) throw new Error("LOCKED");
  if (!res.ok) throw new Error("Failed to delete lineup");
}

async function dbClearMap(mapId) {
  const all = await dbGetAll();
  const toDelete = all.filter(l => l.mapId === mapId);
  for (const l of toDelete) await dbDelete(l.id);
}

async function dbImportBulk(records) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Edit-Password": getEditPassword() },
    body: JSON.stringify({ records }),
  });
  if (res.status === 401) throw new Error("LOCKED");
  if (!res.ok) throw new Error("Failed to import lineups");
}

async function verifyPassword(pw) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Edit-Password": pw },
    body: JSON.stringify({ checkPassword: true }),
  });
  return res.ok;
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
const throwModalHint = document.getElementById("throwModalHint");
const screenshotInput = document.getElementById("screenshotInput");
const thumbGrid = document.getElementById("thumbGrid");
const preciseInput = document.getElementById("preciseInput");
const preciseThumbWrap = document.getElementById("preciseThumbWrap");
const throwRangeSelect = document.getElementById("throwRangeSelect");
const movementSelect = document.getElementById("movementSelect");
const notesInput = document.getElementById("notesInput");
const cancelThrow = document.getElementById("cancelThrow");
const saveThrow = document.getElementById("saveThrow");

const lightboxModal = document.getElementById("lightboxModal");
const lightboxImage = document.getElementById("lightboxImage");
const lightboxCaption = document.getElementById("lightboxCaption");
const lightboxClose = document.getElementById("lightboxClose");
const lightboxPrev = document.getElementById("lightboxPrev");
const lightboxNext = document.getElementById("lightboxNext");

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
const lockBtn = document.getElementById("lockBtn");

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
  lineupCount.textContent = "loading…";
  try {
    const all = await dbGetAll();
    state.lineups = all.filter(l => l.mapId === state.mapId);
    lineupCount.textContent = `${state.lineups.length} lineup${state.lineups.length === 1 ? "" : "s"}`;
    renderMarkers();
  } catch (err) {
    lineupCount.textContent = "load failed";
    console.error(err);
  }
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

lockBtn.onclick = async () => {
  if (isUnlocked()) {
    lockEditing();
    return;
  }
  const pw = prompt("Enter edit password:");
  if (pw === null) return;
  const ok = await verifyPassword(pw);
  if (ok) {
    setEditPassword(pw);
    applyLockState();
  } else {
    alert("Wrong password.");
  }
};

function requireUnlocked() {
  if (isUnlocked()) return true;
  lockBtn.click();
  return false;
}

addModeBtn.onclick = () => {
  if (!requireUnlocked()) return;
  setAddMode(!state.addMode);
};

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

const MAX_SCREENSHOTS = 5;

function compressFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const MAX_DIM = 1280;
        let { width, height } = img;
        if (width > MAX_DIM || height > MAX_DIM) {
          const scale = MAX_DIM / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function renderThumbGrid() {
  thumbGrid.innerHTML = "";
  (pendingThrowDraft.screenshots || []).forEach((src, i) => {
    const t = document.createElement("div");
    t.className = "thumb";
    t.innerHTML = `<img src="${src}"><button class="thumb-remove" type="button">✕</button>`;
    t.querySelector(".thumb-remove").onclick = () => {
      pendingThrowDraft.screenshots.splice(i, 1);
      renderThumbGrid();
    };
    thumbGrid.appendChild(t);
  });
}

function renderPreciseThumb() {
  preciseThumbWrap.innerHTML = "";
  if (!pendingThrowDraft.precise) return;
  const t = document.createElement("div");
  t.className = "thumb";
  t.style.maxWidth = "120px";
  t.innerHTML = `<img src="${pendingThrowDraft.precise}"><button class="thumb-remove" type="button">✕</button>`;
  t.querySelector(".thumb-remove").onclick = () => {
    pendingThrowDraft.precise = null;
    renderPreciseThumb();
  };
  preciseThumbWrap.appendChild(t);
}

screenshotInput.onchange = async () => {
  const files = Array.from(screenshotInput.files || []);
  screenshotInput.value = "";
  if (!files.length) return;
  const room = MAX_SCREENSHOTS - pendingThrowDraft.screenshots.length;
  if (files.length > room) {
    alert(`Only ${MAX_SCREENSHOTS} screenshots allowed per lineup — adding the first ${Math.max(room, 0)}.`);
  }
  const toAdd = files.slice(0, Math.max(room, 0));
  for (const f of toAdd) {
    const dataUrl = await compressFile(f);
    pendingThrowDraft.screenshots.push(dataUrl);
  }
  renderThumbGrid();
};

preciseInput.onchange = async () => {
  const file = preciseInput.files[0];
  preciseInput.value = "";
  if (!file) return;
  pendingThrowDraft.precise = await compressFile(file);
  renderPreciseThumb();
};

function openThrowModal(throwPos, lineupId, isNewLineup, typeId, landingPos, existingThrow) {
  pendingThrowDraft = {
    throwPos,
    lineupId,
    isNewLineup,
    typeId,
    landingPos,
    screenshots: existingThrow ? [...existingThrow.screenshots] : [],
    precise: existingThrow ? existingThrow.precise || null : null,
    editingThrowId: existingThrow ? existingThrow.id : null,
  };

  renderThumbGrid();
  renderPreciseThumb();
  throwRangeSelect.value = existingThrow ? existingThrow.range : "throw";
  movementSelect.value = existingThrow ? existingThrow.movement : "none";
  notesInput.value = existingThrow ? existingThrow.notes || "" : "";

  if (existingThrow) {
    throwModalTitle.textContent = "Edit throw position";
    throwModalHint.textContent = "Editing this throw position's details. The map position stays the same.";
  } else {
    throwModalTitle.textContent = isNewLineup ? "New lineup — throw position" : "Add throw position";
    throwModalHint.textContent = "Click confirmed. Fill in the details below.";
  }
  throwModal.classList.add("show");
}

cancelThrow.onclick = () => {
  closeModal(throwModal);
  pendingThrowDraft = null;
  setAddMode(false);
  state.pendingThrowFor = null;
};

saveThrow.onclick = async () => {
  if (!pendingThrowDraft) return;
  if (!requireUnlocked()) return;
  if (pendingThrowDraft.screenshots.length === 0) {
    if (!confirm("No screenshots attached — save anyway?")) return;
  }

  saveThrow.disabled = true;
  saveThrow.textContent = "Saving…";

  try {
    const draft = pendingThrowDraft;
    const throwEntryBase = {
      pos: draft.throwPos,
      screenshots: draft.screenshots,
      precise: draft.precise,
      range: throwRangeSelect.value,
      movement: movementSelect.value,
      notes: notesInput.value.trim(),
    };

    if (draft.isNewLineup) {
      const lineup = {
        id: draft.lineupId,
        mapId: state.mapId,
        type: draft.typeId,
        landing: draft.landingPos,
        throws: [{ id: uid(), ...throwEntryBase }],
        createdAt: Date.now(),
      };
      await dbPut(lineup);
    } else {
      let lineup = state.lineups.find(l => l.id === draft.lineupId);
      if (!lineup) {
        const all = await dbGetAll();
        lineup = all.find(l => l.id === draft.lineupId);
      }
      if (!lineup) throw new Error("Could not find the lineup to save this throw position to.");

      if (draft.editingThrowId) {
        const idx = lineup.throws.findIndex(t => t.id === draft.editingThrowId);
        if (idx === -1) throw new Error("Could not find the throw position to update.");
        lineup.throws[idx] = { id: draft.editingThrowId, ...throwEntryBase };
      } else {
        lineup.throws.push({ id: uid(), ...throwEntryBase });
      }
      await dbPut(lineup);
    }

    closeModal(throwModal);
    pendingThrowDraft = null;
    setAddMode(false);
    const reopenId = draft.lineupId;
    state.pendingThrowFor = null;
    await loadLineups();
    openDetail(reopenId);
  } catch (err) {
    console.error(err);
    alert(
      err && err.message === "LOCKED"
        ? "Editing is locked — unlock it first."
        : "Could not save: " + (err && err.message ? err.message : err)
    );
  } finally {
    saveThrow.disabled = false;
    saveThrow.textContent = "Save throw position";
  }
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

  renderDetailType(lineup);
  detailTitle.textContent = `${lineup.throws.length} position${lineup.throws.length === 1 ? "" : "s"}`;

  throwList.innerHTML = "";
  lineup.throws.forEach(t => {
    const card = document.createElement("div");
    card.className = "throw-card";

    const gallery = (t.screenshots && t.screenshots.length)
      ? `<div class="throw-card-gallery">${t.screenshots.map((src, i) =>
          `<img src="${src}" data-idx="${i}" alt="throw spot ${i + 1}">`).join("")}</div>`
      : "";

    const precise = t.precise
      ? `<div class="precise-row"><img src="${t.precise}" id="precise-${t.id}"><span>Precise lineup shot</span></div>`
      : "";

    card.innerHTML = `
      ${gallery}
      ${precise}
      <div class="throw-card-body">
        <div class="throw-meta">
          <span class="tag">${RANGE_LABELS[t.range] || t.range}</span>
          <span class="tag">${MOVEMENT_LABELS[t.movement] || t.movement}</span>
        </div>
        ${t.notes ? `<div class="throw-notes">${escapeHtml(t.notes)}</div>` : ""}
        <div class="throw-card-actions">
          <button class="edit-btn">Edit</button>
          <button class="remove-btn">Remove</button>
        </div>
      </div>
    `;

    card.querySelectorAll(".throw-card-gallery img").forEach(imgEl => {
      imgEl.onclick = () => openLightbox(t.screenshots, parseInt(imgEl.dataset.idx, 10), `Throw position · ${lineup.throws.indexOf(t) + 1}`);
    });
    const preciseImg = card.querySelector(`#precise-${t.id}`);
    if (preciseImg) preciseImg.onclick = () => openLightbox([t.precise], 0, "Precise lineup");

    card.querySelector(".edit-btn").onclick = () => {
      if (!requireUnlocked()) return;
      openThrowModal(t.pos, lineup.id, false, lineup.type, lineup.landing, t);
    };

    card.querySelector(".remove-btn").onclick = async () => {
      if (!requireUnlocked()) return;
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

function renderDetailType(lineup) {
  const typeInfo = TYPES.find(t => t.id === lineup.type);
  detailType.textContent = typeInfo.label + " ✎";
  detailType.style.color = "#0a0d0e";
  detailType.style.background = getCssVarColor(typeInfo.color);
  detailType.title = "Click to change nade type";
  detailType.onclick = () => {
    if (!requireUnlocked()) return;
    openTypeModalForEdit(lineup);
  };
}

function openTypeModalForEdit(lineup) {
  buildTypeGrid(async (typeId) => {
    closeModal(typeModal);
    lineup.type = typeId;
    await dbPut(lineup);
    await loadLineups();
    openDetail(lineup.id);
  });
  typeModal.classList.add("show");
}

/* ===================== LIGHTBOX ===================== */

let lightboxState = { images: [], index: 0, caption: "" };

function openLightbox(images, index, caption) {
  const valid = (images || []).filter(Boolean);
  if (!valid.length) return;
  lightboxState = { images: valid, index, caption: caption || "" };
  renderLightbox();
  lightboxModal.classList.add("show");
}

function renderLightbox() {
  lightboxImage.src = lightboxState.images[lightboxState.index];
  const multi = lightboxState.images.length > 1;
  lightboxPrev.style.display = multi ? "" : "none";
  lightboxNext.style.display = multi ? "" : "none";
  lightboxCaption.textContent = multi
    ? `${lightboxState.caption} — ${lightboxState.index + 1} / ${lightboxState.images.length}`
    : lightboxState.caption;
}

lightboxPrev.onclick = () => {
  lightboxState.index = (lightboxState.index - 1 + lightboxState.images.length) % lightboxState.images.length;
  renderLightbox();
};
lightboxNext.onclick = () => {
  lightboxState.index = (lightboxState.index + 1) % lightboxState.images.length;
  renderLightbox();
};
lightboxClose.onclick = () => lightboxModal.classList.remove("show");
lightboxModal.addEventListener("click", (e) => {
  if (e.target === lightboxModal) lightboxModal.classList.remove("show");
});
document.addEventListener("keydown", (e) => {
  if (!lightboxModal.classList.contains("show")) return;
  if (e.key === "Escape") lightboxModal.classList.remove("show");
  if (e.key === "ArrowLeft") lightboxPrev.onclick();
  if (e.key === "ArrowRight") lightboxNext.onclick();
});

function closeDetailPanel() {
  state.selectedLineupId = null;
  detailPanel.classList.remove("open");
  renderMarkers();
}
closeDetail.onclick = closeDetailPanel;

addThrowBtn.onclick = () => {
  if (!requireUnlocked()) return;
  state.pendingThrowFor = state.selectedLineupId;
  setAddMode(true);
  addHint.textContent = "Click the spot you throw from.";
  detailPanel.classList.remove("open");
};

deleteLineupBtn.onclick = async () => {
  if (!requireUnlocked()) return;
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
  if (!requireUnlocked()) { importInput.value = ""; return; }
  const file = importInput.files[0];
  if (!file) return;
  const text = await file.text();
  try {
    const records = JSON.parse(text);
    await dbImportBulk(records);
    await loadLineups();
    alert(`Imported ${records.length} lineups.`);
  } catch (err) {
    alert("Could not import that backup: " + err.message);
  }
  importInput.value = "";
};

clearBtn.onclick = async () => {
  if (!requireUnlocked()) return;
  if (!confirm(`Delete ALL lineups on ${MAPS.find(m => m.id === state.mapId).name}?`)) return;
  await dbClearMap(state.mapId);
  closeDetailPanel();
  await loadLineups();
};

/* ===================== BOOT ===================== */

buildSidebar();
buildFilters();
applyLockState();
selectMap(state.mapId);
