// Reply threads on feedback items (sql/010_feedback_replies.sql), shared by
// api/feedback.js (the sender's side) and api/admin.js (the admin side).

const REPLY_MAX = 2000;

// { [feedbackId]: [{ id, fromAdmin, body, createdAt }] }, oldest first.
async function repliesFor(sb, ids) {
  const out = {};
  if (!ids.length) return out;
  const { data, error } = await sb.from("feedback_replies")
    .select("id, feedback_id, from_admin, body, created_at")
    .in("feedback_id", ids).order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  for (const r of data || []) {
    (out[r.feedback_id] || (out[r.feedback_id] = [])).push({ id: r.id, fromAdmin: r.from_admin, body: r.body, createdAt: r.created_at });
  }
  return out;
}

// Adds a reply and flags who has to look next: an admin reply lights the
// sender's dot (last_admin_reply_at), a sender reply puts the item back in
// the admin's count (needs_admin).
async function addReply(sb, { feedbackId, authorId, fromAdmin, body }) {
  const { data, error } = await sb.from("feedback_replies")
    .insert({ feedback_id: feedbackId, author_id: authorId, from_admin: fromAdmin, body })
    .select("id, from_admin, body, created_at").single();
  if (error) throw new Error(error.message);
  // The API's clock, not the row's created_at: closed_at and user_seen_at
  // are stamped here too, so all three compare on the same clock.
  const flags = fromAdmin ? { last_admin_reply_at: new Date().toISOString(), needs_admin: false } : { needs_admin: true };
  const { error: flagErr } = await sb.from("feedback").update(flags).eq("id", feedbackId);
  if (flagErr) throw new Error(flagErr.message);
  return { id: data.id, fromAdmin: data.from_admin, body: data.body, createdAt: data.created_at };
}

module.exports = { REPLY_MAX, repliesFor, addReply };
