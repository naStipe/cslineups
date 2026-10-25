// When may someone other than its owner see a PERSONAL lineup?
// Only while its owner has put it in a collection they've shared: visibility
// "unlisted" or "public", and not hidden by moderation. Sharing a collection
// is the owner's explicit act (the share dialog says so), and it ends the
// moment they make the collection private again, delete it, or take the
// lineup out. Everything that serves another user's personal lineup or
// private screenshot goes through here.
const { imageUrls } = require("./uploads");

const privateUrl = (ownerId, filename) => `/api/private-image?path=${ownerId}/${filename}`;

// Of the given lineup rows (need id, is_official, owner_id), returns the set of
// ids that are personal AND currently shared by their owner.
async function sharedPersonalIds(sb, rows) {
  const personal = (rows || []).filter(r => r && !r.is_official && r.owner_id);
  if (!personal.length) return new Set();
  const { data, error } = await sb.from("collection_items")
    .select("lineup_id, collections!inner(owner_id, visibility, moderation_hidden_at)")
    .in("lineup_id", personal.map(r => r.id));
  if (error) throw new Error(error.message);
  const ownerOf = new Map(personal.map(r => [r.id, r.owner_id]));
  const out = new Set();
  for (const it of data || []) {
    const c = it.collections;
    if (c && c.visibility !== "private" && !c.moderation_hidden_at && c.owner_id === ownerOf.get(it.lineup_id)) out.add(it.lineup_id);
  }
  return out;
}

// Is this private screenshot / clip (owner's folder + filename) used by one of
// the owner's lineups that is currently shared?
async function isSharedPrivateImage(sb, ownerId, filename) {
  const { data: cols, error } = await sb.from("collections").select("id")
    .eq("owner_id", ownerId).neq("visibility", "private").is("moderation_hidden_at", null);
  if (error) throw new Error(error.message);
  if (!cols || !cols.length) return false;
  const { data: items, error: ierr } = await sb.from("collection_items").select("lineup_id")
    .in("collection_id", cols.map(c => c.id)).not("lineup_id", "is", null);
  if (ierr) throw new Error(ierr.message);
  const ids = [...new Set((items || []).map(i => i.lineup_id))];
  if (!ids.length) return false;
  const { data: lineups, error: lerr } = await sb.from("lineups").select("throws")
    .in("id", ids).eq("owner_id", ownerId).eq("is_official", false);
  if (lerr) throw new Error(lerr.message);
  const want = privateUrl(ownerId, filename);
  return (lineups || []).some(l => imageUrls(l.throws).includes(want));
}

module.exports = { sharedPersonalIds, isSharedPrivateImage };
