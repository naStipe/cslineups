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
