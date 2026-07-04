import { openAuthModal } from "./auth-modal.js";
import { authUser, isAdmin } from "./auth.js";
import { state } from "./state.js";

export function canModifyLineup(lineup) {
  if (!authUser || !lineup) return false;
  if (lineup.isOfficial) return isAdmin();
  return lineup.ownerId === authUser.id;
}

export function requireCanCreate() {
  if (!authUser) { openAuthModal("signin"); return false; }
  if (state.viewMode === "official" && !isAdmin()) {
    alert('Only admins can add official lineups. Switch to "My Map" to add your own.');
    return false;
  }
  return true;
}

export function requireLineupEditable(lineup) {
  if (!authUser) { openAuthModal("signin"); return false; }
  if (!canModifyLineup(lineup)) {
    alert(lineup && lineup.isOfficial
      ? "Only admins can edit official lineups."
      : "You can only edit your own lineups.");
    return false;
  }
  return true;
}
