# SQL migrations

Numbered, additive schema changes for the Supabase project. Files `001`–`004`
were applied to the live project on 2026-10-25 and are reconstructed here from
the live schema so the repo matches the database. New changes: add the next
number, then apply it (Supabase MCP `apply_migration` or the SQL editor).

All new tables have RLS enabled with **no policies**: they are only reachable
through the service-role key used by `api/*`, which does its own auth,
ownership and visibility checks. Never add a permissive policy without also
updating the corresponding endpoint.

`draft_map_areas.json` is a backup of the first-draft A / Mid / B polygons that
were in `map_areas` (27 rows, `[x, y]` pairs). They are kept out of production
until the polygons have been refined in the admin Areas tab.
