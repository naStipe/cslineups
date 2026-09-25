// Per-user rate limiting for public write endpoints, backed by the
// check_rate_limit() Postgres function (see the add_rate_limit_table_and_function
// migration) — an atomic UPSERT so concurrent requests can't race past the
// cap. Needed because every route here authorizes with the Supabase
// service-role key, which has no request-rate concept of its own: an
// account past sign-up (itself Turnstile-gated) could otherwise write
// without limit.
const LIMITS = {
  lineup_write: { max: 30, windowSeconds: 3600 },   // create/edit a lineup
  saved_lineup: { max: 120, windowSeconds: 3600 },  // bookmark/unbookmark a throw
  upload:       { max: 60, windowSeconds: 3600 },   // presign an image upload
};

// Returns true if the call is allowed, false if the caller is over the cap
// for this action. Throws only on an actual DB error.
async function checkRateLimit(sb, userId, action) {
  const limit = LIMITS[action];
  if (!limit) throw new Error(`Unknown rate limit action: ${action}`);
  const { data, error } = await sb.rpc("check_rate_limit", {
    p_user_id: userId,
    p_action: action,
    p_max_count: limit.max,
    p_window_seconds: limit.windowSeconds,
  });
  if (error) throw new Error(error.message);
  return !!data;
}

module.exports = { checkRateLimit };
