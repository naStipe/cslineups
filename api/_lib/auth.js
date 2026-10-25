// Shared request authentication for every api/* route.
//
// Each route used to call sb.auth.getUser(token), which is a network round
// trip to Supabase Auth on every single request (an image upload used to
// cost three of them). getClaims() verifies the access token locally
// instead:
//  - Asymmetric signing keys (ES256/RS256, what Supabase's "JWT signing
//    keys" produce): the signature is checked with WebCrypto against the
//    project's JWKS (/auth/v1/.well-known/jwks.json). supabase-js caches
//    the key set at module level for 10 minutes, so on a warm function this
//    is pure CPU. An unknown `kid` forces a refetch.
//  - Legacy symmetric secret (HS256) or no WebCrypto: getClaims falls back
//    to getUser() itself, i.e. exactly the old behaviour (no speedup, no
//    regression). Moving the project to asymmetric keys is what turns the
//    speedup on.
//  - Expiry: getClaims rejects a missing or past `exp` before anything else.
//
// What getClaims does NOT check (read from auth-js 2.110 GoTrueClient
// getClaims/decodeJWT/validateExp): audience, issuer, `sub`, or `role`.
// Audience, sub and role are enforced below, so a token minted by this project for some other
// purpose (e.g. a legacy anon/service JWT, which has role anon/service_role
// and no user `sub`) can't pass as a signed-in user. Issuer is deliberately
// not compared: the signature already proves this project signed the token
// (the JWKS comes from SUPABASE_URL), and a custom-domain SUPABASE_URL would
// not match the `iss` string and lock every user out.
//
// Trade-off of local verification: a token stays valid until it expires
// (Supabase default: 1 hour) even after sign-out or a ban, because nothing
// asks the auth server. Routes that must see that instantly (none today)
// should keep calling sb.auth.getUser().

function bearerToken(req) {
  const header = req.headers["authorization"] || req.headers["Authorization"];
  if (!header) return { reason: "no Authorization header reached the API" };
  if (!header.startsWith("Bearer ")) return { reason: "Authorization header is not a Bearer token" };
  const token = header.slice(7).trim();
  if (!token) return { reason: "Bearer token was empty" };
  return { token };
}

function hasAudience(aud, wanted) {
  return Array.isArray(aud) ? aud.includes(wanted) : aud === wanted;
}

// Returns { user: { id, email, claims } } or { reason } explaining exactly
// why authentication failed (api/admin.js surfaces the reason in its 401).
async function authenticate(req, sb) {
  const { token, reason } = bearerToken(req);
  if (!token) return { reason };

  let data, error;
  try {
    ({ data, error } = await sb.auth.getClaims(token));
  } catch (err) {
    return { reason: `token could not be verified: ${err && err.message || err}` };
  }
  if (error) return { reason: `token rejected: ${error.message}` };
  const claims = data && data.claims;
  if (!claims || typeof claims.sub !== "string" || !claims.sub) return { reason: "token has no user" };
  if (!hasAudience(claims.aud, "authenticated") || claims.role !== "authenticated") {
    return { reason: "token is not a signed-in user token" };
  }

  return { user: { id: claims.sub, email: claims.email || null, claims } };
}

// Verifies the bearer token and returns the user it belongs to
// ({ id, email, claims }), or null if missing/invalid.
async function getAuthUser(req, sb) {
  const { user } = await authenticate(req, sb);
  return user || null;
}

// Looks up whether a user is flagged as an admin in public.profiles.
async function isAdmin(sb, userId) {
  if (!userId) return false;
  const { data, error } = await sb.from("profiles").select("is_admin").eq("id", userId).maybeSingle();
  if (error || !data) return false;
  return !!data.is_admin;
}

module.exports = { authenticate, getAuthUser, isAdmin };
