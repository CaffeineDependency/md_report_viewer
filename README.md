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
  project/source files (pdf, zip, c/cpp/h, py, txt, csv, Proteus projects, …)
  stored in Workers KV (no payment method required, unlike R2); never
  delivered with an executable/HTML content type.
- **Persian-first**: RTL layout, Vazirmatn font (self-hosted), Jalali dates,
  Persian UI strings and error messages.
- **Themes**: dark by default with a header toggle (choice remembered); teal
  accent in both palettes.
- **Responsive by design**: a purpose-built phone layout and a wide desktop
  layout — not one squeezed into the other. Phones get full-bleed, swipeable
  tables (with a Persian "swipe" hint that only appears when needed), stacked
  upload/asset rows and ≥44px tap targets; desktops get a 74–80rem shell,
  a multi-column home and a 50rem reading column. Checked at 320, 390, 768,
  1440 and 1920 px.
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
| `npm run smoke` | 44-check end-to-end test against a running `wrangler dev` (works against production too) |
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
  *images* are blocked by the CSP (`img-src 'self'`), so screenshots should be
  uploaded here; Drive also blocks hotlinking.
- No multi-user, no comments, no syntax highlighting, no AI integration.
