#!/usr/bin/env node
// Build step run by Vercel (see vercel.json "buildCommand"): fingerprints
// the js/ folder as one versioned directory so it can be cached forever.
//
// Internal modules use relative imports ("./dom.js"), so moving the whole
// folder to js/<hash>/ keeps every import resolving correctly without
// having to rewrite each import specifier individually.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const root = path.join(__dirname, "..");
const jsDir = path.join(root, "js");

const files = fs.readdirSync(jsDir).filter((f) => f.endsWith(".js")).sort();

const hash = crypto
  .createHash("sha256")
  .update(files.map((f) => fs.readFileSync(path.join(jsDir, f))).reduce((a, b) => Buffer.concat([a, b])))
  .digest("hex")
  .slice(0, 10);

const versionedDir = path.join(jsDir, hash);
fs.mkdirSync(versionedDir, { recursive: true });
for (const f of files) {
  fs.copyFileSync(path.join(jsDir, f), path.join(versionedDir, f));
}
for (const f of files) {
  fs.rmSync(path.join(jsDir, f));
}

for (const [htmlFile, entry] of [
  ["index.html", "main.js"],
  ["admin.html", "admin.js"],
]) {
  const htmlPath = path.join(root, htmlFile);
  const html = fs.readFileSync(htmlPath, "utf8");
  const updated = html.replace(`src="js/${entry}"`, `src="js/${hash}/${entry}"`);
  if (updated === html) {
    throw new Error(`hash-js: could not find js/${entry} reference in ${htmlFile}`);
  }
  fs.writeFileSync(htmlPath, updated);
}

console.log(`hash-js: versioned js/ as js/${hash}/ (${files.length} files)`);
