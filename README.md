# Lineups — personal grenade lineup database

A website for storing CS2 grenade lineups on interactive maps, similar to csnades.gg. Click a
map to drop a "landing spot" marker, then click again to set the "throw from" spot and attach
a screenshot, throw type, key bind, and notes.

## How it works

- Static frontend (HTML/CSS/JS, no build step) + one small serverless function.
- Data (including screenshots) is stored server-side using **Netlify Blobs**, so it's shared
  across every browser/device that visits your deployed site — not stuck in one browser.
- The function lives at `netlify/functions/lineups.js` and is called by the frontend at
  `/.netlify/functions/lineups` (GET to load, POST to save, DELETE to remove).
- **Export backup** / **Import backup** in the sidebar still work, as a manual JSON download/
  upload safety net on top of Blobs.

## Run it locally

Netlify Blobs and functions need the Netlify CLI to run locally (a plain `http.server` won't
have the `/netlify/functions` route):

```bash
npm install -g netlify-cli
cd csnades-site
npm install
netlify dev
```

This serves the site (usually at `http://localhost:8888`) with the function and blob storage
working, using a local emulation of Blobs.

## Deploy

Push to GitHub and connect the repo in Netlify (Import an existing project → Deploy with
GitHub). Leave **Build command** blank and set **Publish directory** to `.`. Netlify Blobs
needs no extra setup or environment variables — it's automatically available once the site is
deployed on Netlify. Every `git push` to `main` redeploys automatically, function included.

## Adding/changing maps

Map images live in `/maps`. To add a new map, drop an image in that folder and add an entry
to the `MAPS` array at the top of `app.js`:

## Password-protecting edits

The site is viewable by anyone with the link, but adding/editing/deleting lineups requires a
password — set it once in Netlify:

1. Netlify dashboard → your site → **Site configuration** → **Environment variables** → **Add a variable**.
2. Key: `EDIT_PASSWORD`, value: whatever password you want.
3. Redeploy (or it picks it up on the next push/deploy).

In the app, click **🔒 Unlock editing** in the sidebar and enter that password — it's then
remembered for your browser tab (not saved permanently, so you'll unlock again next visit,
keeping things reasonably safe on shared computers). Without unlocking, visitors can browse
every map and lineup but the add/edit/delete controls are blocked, both in the UI and on the
server side. If you never set `EDIT_PASSWORD`, editing stays open to everyone.



Netlify Blobs has a generous free-tier size limit (well into the GB range), so screenshots as
base64 should be fine for personal use. If you outgrow it or want multiple users with logins,
the natural next step is Supabase (Postgres + file storage) — the function in
`netlify/functions/lineups.js` is a thin enough layer that swapping the backend later is
straightforward.


## If you see "Netlify Blobs is not configured" errors

Some Netlify accounts/runtimes don't auto-inject Blobs credentials into functions. If you see
an error like `The environment has not been configured to use Netlify Blobs`, add two
environment variables (same place as `EDIT_PASSWORD`, in **Site configuration → Environment
variables**):

- `NETLIFY_SITE_ID` — find it in **Site configuration → General → Site details → Site ID**.
- `NETLIFY_AUTH_TOKEN` — create one at **User settings → Applications → Personal access
  tokens → New access token** (give it a name, no special scopes needed beyond default).

Add both, then trigger a new deploy. The function automatically uses these if present, and
falls back to automatic context if they're not set.
