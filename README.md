# Lineups — personal grenade lineup database

A static website (no backend needed) for storing CS2 grenade lineups on interactive maps,
similar to csnades.gg. Click a map to drop a "landing spot" marker, then click again to set
the "throw from" spot and attach a screenshot, throw type, key bind, and notes.

## How it works

- Pure HTML/CSS/JS, no build step, no server.
- All your data (including screenshots) is stored locally in your browser via **IndexedDB**.
  That means data is private to you and persists across visits, but only on the device/browser
  you used to add it.
- Use **Export backup** in the sidebar regularly to download a `.json` file with everything,
  and **Import backup** to restore it (or move it to another browser/device).

## Run it locally

You can't just double-click `index.html` (browsers block module/fetch-like access to local
files for some features). Instead, serve the folder:

```bash
cd csnades-site
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## Deploy it as a real website

Any static host works. Easiest options:

**Netlify / Vercel (drag and drop)**
1. Go to netlify.com (or vercel.com) → sign up free.
2. Drag the whole `csnades-site` folder onto the deploy area.
3. You get a public URL instantly (e.g. `your-lineups.netlify.app`).

**GitHub Pages**
1. Create a new GitHub repo, push these files to it.
2. Repo Settings → Pages → set source to the `main` branch, root folder.
3. Your site appears at `https://yourusername.github.io/reponame`.

## Adding/changing maps

Map images live in `/maps`. To add a new map, drop an image in that folder and add an entry
to the `MAPS` array at the top of `app.js`:

```js
{ id: "vertigo", name: "Vertigo", file: "maps/vertigo.webp" }
```

## Notes on storage limits

IndexedDB typically allows hundreds of MB to a few GB depending on the browser, so you can
store a lot of screenshots before running into limits. If you ever want a true multi-device
synced database, the next step would be adding a small backend (e.g. Supabase) — happy to
help with that later if you want it.
