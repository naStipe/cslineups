# Lineupr

A CS2 grenade lineup site: interactive maps with landing spots, throw-from spots, screenshots,
notes and shareable collections.

## Stack

- **Frontend**: static HTML/CSS/vanilla JS ES modules, no framework. Entry points are
  `index.html` (home, map app) and `admin.html`; code is in `js/*.js`, styles in `style.css`.
  `scripts/hash-js.js` is the only build step (Vercel runs it, see `buildCommand` in
  `vercel.json`): it moves `js/` to a content-hashed folder for long-lived caching.
- **API**: Vercel serverless functions in `api/*.js` (shared helpers in `api/_lib/`).
  `vercel.json` also holds headers, redirects and the rewrites for the server-rendered pages
  (`/maps`, `/<map>`, `/<map>/<type>/<slug>`, `/c/<slug>`, `/sitemap.xml`).
- **Supabase**: auth (email/password, Google) and Postgres. The browser talks to Supabase only
  for auth; all data access goes through `api/*`, which uses the service-role key and does its
  own ownership and visibility checks. Schema changes live in `sql/` as numbered migrations
  (see `sql/README.md`; new tables have RLS on and no policies).
- **Cloudflare R2**: screenshot and clip storage. `api/upload-url.js` issues presigned uploads
  to a public bucket (official content) or a private bucket (personal lineups, served through
  `api/private-image.js`).
- **Cloudflare Turnstile** guards sign-up and sign-in forms.

## Environment variables

Names only; set them in the Vercel project (or a local `.env.local`, which is git-ignored).

| Variable | Used for |
| --- | --- |
| `SUPABASE_URL` | Supabase project URL (API and `/api/config`) |
| `SUPABASE_ANON_KEY` | Public anon key, handed to the browser by `/api/config` |
| `SUPABASE_SERVICE_KEY` | Service-role key, server only |
| `R2_ENDPOINT` | R2 S3 endpoint |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | R2 credentials |
| `R2_PUBLIC_BUCKET`, `R2_PRIVATE_BUCKET` | Bucket names |
| `R2_PUBLIC_BASE_URL` | Public base URL for the public bucket |
| `SITE_URL` | Optional. Canonical origin (defaults to the production domain); used for CORS and SEO |
| `ALLOWED_ORIGINS` | Optional. Extra comma-separated CORS origins (e.g. staging) |

## Run locally

```bash
npm install
npm i -g vercel        # once
vercel link            # once, then `vercel env pull .env.local` to fetch the variables
vercel dev             # http://localhost:3000 with /api/* and the rewrites working
```

A plain static server serves the pages but not `/api/*`, so nothing would load.

## Dev UI harness

`scripts/ui-harness.js` is a dev-only Playwright harness (not deployed; `vercel.json` redirects
`/scripts/*`). It serves the repo statically, mocks `/api/**` with sample lineups and a sample
collection, and prints bounding boxes so layout jumps can be measured. It needs no Supabase or
R2 access. Usage is in the header of the file, for example:

```bash
node scripts/ui-harness.js --url "/?map=mirage&collection=demo-set" --viewport 390x844 --selectors ".step-bar"
```

## Deploy

Push to the connected branch; Vercel builds with `node scripts/hash-js.js` and publishes the
repo root as static output with `api/` as functions. Apply new `sql/` migrations to the
Supabase project before shipping code that needs them.
