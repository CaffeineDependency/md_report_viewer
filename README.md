# گزارش‌کار (Gozaresh-Kar)

A Persian, RTL, single-admin lab-report repository on Cloudflare Workers.
Reports are Markdown (produced outside the app by AI assistants or people);
the site renders, publishes, archives and serves their images and project
files. Public visitors get fast server-rendered pages; one admin manages
everything behind a password.

Full architecture and current state: see [HANDOFF.md](HANDOFF.md).
Step-by-step production deployment: see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Features

- **Reports**: write/paste Markdown, live preview (same renderer as the live
  site), categories, comma-separated tags, publish/unpublish, trash with
  restore, permanent delete that also cleans up unreferenced files.
- **Assets**: image uploads (PNG/JPEG/WebP/GIF, verified by magic bytes) and
  **any downloadable file** — any extension or none at all (pdf, zip, source,
  Proteus projects, extensionless data files, …) — stored in Workers KV (no
  payment method required, unlike R2). Downloads are always attachments with a
  non-executable content type and `nosniff`, so HTML/executables cannot run.
- **Remote images**: Markdown may embed images from any `https`/`http` host
  (GitHub raw, image CDNs, etc.); they render in preview, public pages and
  PDFs, with `referrerpolicy="no-referrer"`. Hosts that block hotlinking,
  plain-HTTP images on the HTTPS site, private links and GitHub *blob* pages
  (use raw URLs) are the exceptions.
- **Persian-first**: RTL layout, Vazirmatn font (self-hosted), Jalali dates,
  Persian UI strings and error messages.
- **Themes**: dark by default with a header toggle (choice remembered); teal
  accent in both palettes.
- **Responsive by design**: a purpose-built phone layout and a wide desktop
  layout — not one squeezed into the other. Phones get inset, rounded
  table/code cards that scroll inside themselves (with a Persian "swipe" hint
  that only appears when needed), stacked upload/asset rows and ≥44px tap
  targets; desktops get a 74–80rem shell,
  a multi-column home and a 50rem reading column. Checked at 320, 390, 768,
  1440 and 1920 px.
- **Readable code**: fenced blocks are highlighted server-side (C, C++,
  Arduino, Python, Bash/Shell, Verilog, VHDL, Matlab, JSON, JavaScript, SQL,
  Makefile, diff, YAML, XML) with IDE-style colors in both themes; unknown
  languages stay plain, and the copy button still copies the raw text.
- **Print / PDF**: every report has a «چاپ / PDF» button that opens the
  browser print dialog with an A4 page, 15mm/14mm margins, a light
  ink-friendly layout, colored code, and table headers repeated on each page.
  Choose "Save as PDF" there.
- **Search**: title/tag substring search and category chips on the homepage.
- **Security**: PBKDF2 password hash, signed stateless session cookie, CSRF
  protection on all mutations, strict CSP (`default-src 'none'`; no inline
  scripts), login rate-limiting, MIME-safe serving with `nosniff`,
  `Content-Disposition: attachment` for files.

## Quick start (local)

```sh
npm install
cp .dev.vars.example .dev.vars     # insert your own generated values
npx wrangler d1 migrations apply gozaresh-kar-db --local
npx wrangler dev                   # http://localhost:8787
```

Generate local secret values:

```sh
node scripts/hash-password.mjs MY_DEV_PASSWORD          # ADMIN_PASSWORD_HASH
node -e "console.log(crypto.randomBytes(32).toString('base64url'))"  # SESSION_SECRET
```

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | `wrangler dev` on <http://localhost:8787> |
| `npm test` | unit tests (markdown renderer, asset validation) |
| `npm run smoke` | 51-check end-to-end test against a running `wrangler dev` (works against production too) |
| `npm run deploy` | deploy Worker + assets + bindings config to Cloudflare |
| `node scripts/hash-password.mjs <pw>` | generate `ADMIN_PASSWORD_HASH` |

## Project layout

```
migrations/0001_init.sql   D1 schema (reports, assets, report_assets, login_attempts)
src/index.js               Worker entry: routing + Persian 404/500 pages
src/router.js              tiny router (params, wildcards, HEAD fallback)
src/routes/                public | admin pages | api | assets (upload/serve)
src/lib/                   renderer (markdown→safe HTML), reports, assets,
                           auth (PBKDF2/session/rate-limit), cleanup, html, persian
public/                    static assets directory (css/js/fonts, no build step)
public/static/js/          theme, login, editor, uploads, assets, trash, report (lightbox/copy)
scripts/hash-password.mjs  password-hash generator (Node-compatible WebCrypto scheme)
tests/                     renderer/assets unit tests + smoke.mjs e2e
```

## Data model in one sentence

`reports` ↔ `report_assets` ↔ `assets` — Markdown references assets by URL
(`/images/<uuid>.<ext>`, `/files/<uuid>/<name>`); every save rebuilds the link
table; deleting a report purges bytes that no other report references; a
`POST /api/cleanup` sweeper is retry-safe for anything that failed halfway.

## Limits (v1, by design)

- Single admin with a password; stateless sessions (rotating `SESSION_SECRET`
  revokes all sessions; logout clears the browser cookie only).
- Markdown ≤ 1 MB, images ≤ 10 MB, files ≤ 25 MB (configurable in
  `wrangler.toml [vars]`). 25 MB is also Workers KV's hard per-value ceiling,
  so it cannot be raised while assets live in KV.
- Larger files: host them elsewhere (e.g. Google Drive set to "anyone with
  the link") and link them from the Markdown — normal links just work. Remote
  images can be embedded directly, but many hosts (including Google Drive)
  block hotlinking; uploading them here is still the most reliable option.
- No multi-user, no comments, no AI integration; PDF export uses the browser's
  print dialog (no server-side PDF engine).
