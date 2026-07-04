import { API_URL } from "./api.js";
import { exportBtn } from "./dom.js";

exportBtn.onclick = async () => {
  try {
    exportBtn.textContent = "Exporting…";
    // No mapId filter — fetches all lineups across every map
    const res = await fetch(API_URL);
    if (!res.ok) throw new Error(`${res.status}`);
    const all = await res.json();
    const blob = new Blob([JSON.stringify(all, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `lineups-backup-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    alert("Export failed: " + err.message);
  } finally {
    exportBtn.textContent = "Export backup";
  }
};
