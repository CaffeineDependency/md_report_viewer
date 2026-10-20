# HANDOFF — گزارش‌کار (Gozaresh-Kar)

A Persian-language laboratory report repository running on Cloudflare.
This document explains what the project is, exactly where it stands, and how
every part works, so a new maintainer (human or agent) can continue without
guessing. Code comments, identifiers and docs are English; every user-facing
string is Persian; deployment lives in `docs/DEPLOYMENT.md`.

---

## 1. What this project is

A single-admin website for publishing, editing and archiving lab reports.
Reports are written in Markdown (usually produced by external AI assistants,
never by the site itself — there is no AI integration of any kind). A report
may contain Persian text, images (schematics, screenshots, oscilloscope
captures), source code (C/C++/Python/Verilog/…), tables, and downloadable
project files (PDF, ZIP, Proteus/Simulation projects).

Personas:

- **Admin** (one person, single password): uploads assets, pastes Markdown,
  previews it, publishes with an explicit confirmation, edits or trashes
  reports, restores them, purges permanently, prunes unused files.
- **Visitor**: reads the public site. No account, no interaction.

## 2. Current status (as of this handoff)

| Phase | Scope | State |
|---|---|---|
| 1 | Skeleton, D1 migration, auth (PBKDF2, session cookie, lockout, CSRF) | ✅ done, live-verified |
| 2 | Report CRUD, shared Markdown renderer, preview, publish, server-rendered report pages | ✅ done, live-verified |
| 3 | Uploads (Worker→KV), asset library, editor insert/copy, `/images/*` `/files/*` serving | ✅ done, live-verified (+prod) |
| 4 | Trash/restore, permanent delete, idempotent cleanup sweeper | ✅ done, live-verified |
| 5 | Search/category filter, lightbox, copy-code, favicon, polish | ✅ done, live-verified (+prod) |
| 6 | Smoke script, README, deployment guide, real deployment | ✅ done — LIVE at https://gozaresh-kar.parsamirzaagha0.workers.dev |
| 7 | UI overhaul: dark theme (default) + toggle, teal accent, phone overflow fixes, desktop home grid, dashboard delete bug | ✅ done, live-verified (44/44 smoke on prod) |
| 8 | Responsive pass: real desktop layout (auto-fit grid, 74–80rem shell), phone report redesign (inset rounded table/code cards, denser cells, swipe hint), page-wide overflow guard | ✅ done, live-verified (44/44 smoke on prod) |
| 9 | Syntax highlighting (highlight.js, server-side) + print/PDF export (A4 print stylesheet, light theme, colored code) | ✅ done, live-verified (46/46 smoke on prod) |
| 10 | Remote images allowed (any http/https host) + any file type uploads (extensionless included) | ✅ done, live-verified (51/51 smoke on prod) |

Everything verified locally against `wrangler dev` and then re-verified
against the live production Worker (51-check smoke suite: 51/51 on both).
Remaining open items and manual browser checks — see §13.

## 3. Architecture on Cloudflare

One Worker process covers everything dynamic; Cloudflare's Static Assets
pipeline serves the frontend files directly (without invoking the Worker).
All data lives in D1 (metadata) and Workers KV (bytes). No other services. **KV replaced the originally-planned R2 because the target Cloudflare account has no payment method; enabling R2 requires one, KV does not (it is part of the Workers free plan).**

```
                       ┌───────────────────────────────┐
      browser ────────►│  Cloudflare edge              │
                       │                               │
   static css/js/fonts │  Static Assets  (public/)     │  no Worker invoked
   /favicon.svg        │                               │
                       │  run_worker_first patterns:   │
   /, /login, /reports/*, /images/*, /files/*,          │
   /api/*, /admin, /admin/*                            │
                       │        │                      │
                       │        ▼                      │
                       │  Worker (src/index.js)        │
                       │   ├ router.js                 │
                       │   ├ routes/public.js  → SSR HTML (homepage, report page)
                       │   ├ routes/admin.js   → auth-gated admin pages
                       │   ├ routes/api.js     → JSON API (auth, reports, cleanup)
                       │   ├ routes/assets.js  → upload/list/delete + asset serving
                       │   └ lib/{renderer,reports,assets,cleanup,auth,persian,html}.js
                       │        │            │         │
                       │        ▼            ▼         ▼
                       │      D1 (DB)   KV (BUCKET)  env.ASSETS
                       └───────────────────────────────┘
```

Bindings (wrangler.toml):

| Binding | Kind | Purpose |
|---|---|---|
| `DB` | D1 `gozaresh-kar-db` | reports, assets, report_assets, login_attempts |
| `BUCKET` | KV namespace `f915ebc7e3c8447da7c60d3f186041b2` | image/file bytes only (keys `images/<uuid>.<ext>`, `files/<uuid>/<name>`, metadata `{kind, contentType, created_at}`) |
| `ASSETS` | Static Assets `./public` | css/js/fonts/favicon; also used indirectly by Cloudflare |

Non-secret vars: `MAX_IMAGE_MB` (10), `MAX_FILE_MB` (25), `SESSION_TTL_HOURS` (168).
Secrets (set with `wrangler secret put`, mirrored locally in `.dev.vars`):
`ADMIN_PASSWORD_HASH` (`pbkdf2$100000$<salt b64url>$<hash b64url>`), `SESSION_SECRET` (32-byte base64url).
`node scripts/hash-password.mjs <password>` produces the identical hash value
the Worker computes with WebCrypto PBKDF2 (SHA-256, 256-bit key).

## 4. URL scheme and routing

`run_worker_first = ["/", "/login", "/reports/*", "/images/*", "/files/*", "/api/*", "/admin", "/admin/*"]`
— everything else in `public/` is served by Cloudflare without the Worker.
There is **no SPA fallback**; unknown static paths 404 naturally.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/` | no | homepage list; `?q=` (title+tags LIKE, escaped) and `?category=` |
| GET | `/reports/:slug` | no | server-rendered report (published only; drafts/trash 404) |
| GET | `/login` | no | Persian login form (fetch-based submit) |
| POST | `/api/auth/login` · `/logout` | no/any | PBKDF2 verify + HMAC cookie; 5 failures ⇒ 15 min lockout |
| GET | `/admin` | yes | dashboard: report list, stats, delete-to-trash buttons |
| GET | `/admin/new`, `/admin/edit/:id` | yes | Markdown editor (load/save/preview/publish) |
| GET | `/admin/assets` | yes | asset library (upload, usage counts, copy URL, delete unused) |
| GET | `/admin/trash` | yes | trash (restore / permanent purge) + cleanup button |
| GET/POST/PUT/DELETE | `/api/reports…` | yes | CRUD + `publish`/`unpublish` + `restore` + `permanent` |
| POST | `/api/preview` | yes | Markdown → safe HTML via the one shared renderer |
| POST/GET/DELETE | `/api/assets…` | yes | upload (multipart), list with usage counts, delete unreferenced |
| POST | `/api/cleanup` | yes | retry-safe sweeper (pending_delete, orphaned, KV-without-row) |
| GET | `/images/:id.ext`, `/files/:id/:name` | no | KV serving with safe headers |

Router (src/router.js): tiny hand-written matcher, `:param` segments and
trailing `*` wildcards; handlers are `handler(request, env, params, ctx)`;
HEAD falls through to GET handlers (body discarded by the runtime).

## 5. Data model (D1, migration 0001_init.sql)

- `reports`: `id` uuid PK, `slug` 12-char unambiguous random ID (**immutable**),
  `title`, `markdown` (≤1 MB enforced), `status` draft|published|deleted,
  `category`, `tags` (normalized comma list), `created_at`, `updated_at`,
  `deleted_at`.
- `assets`: `id` uuid PK, `r2_key` unique (KV object key; historical column name), `kind` image|file,
  `original_filename` sanitized, `content_type` (server-decided, never
  HTML-like), `size`, `status` active|pending_delete, `created_at`.
- `report_assets`: (report_id, asset_id) rebuilt on every save by scanning the
  Markdown for `/images/<uuid>` / `/files/<uuid>` references.
- `login_attempts`: per-IP failure counter + `locked_until`.

Report identity never changes: editing updates content only. Slugs are
regenerated never; collisions on create are retried (5 attempts, 62⁻¹² odds).

## 6. Security model

- **Auth**: password stored as salted PBKDF2-SHA256 (100k iterations), constant-time
  compare; session = HMAC-SHA256-signed stateless cookie
  (`HttpOnly; Secure; SameSite=Strict; Path=/`, 7-day TTL). No session table.
- **CSRF**: every state-changing request requires (1) `Origin` equal to site
  origin, (2) header `X-Requested-With: fetch`, on top of SameSite=Strict.
- **Rate limiting**: D1 counter, 5 failures ⇒ 15-minute lockout per IP
  (`CF-Connecting-IP`).
- **Markdown** (`src/lib/renderer.js`, the single pipeline for preview AND
  public pages): `html:false` (raw HTML escaped), `validateLink` allowing only
  `http:`, `https:`, `mailto:`, same-site `/…` paths and `#anchors` —
  `javascript:`, `data:`, `vbscript:`, `//host`, scheme-less relatives are
  rejected. Fenced/indented code becomes LTR `<figure class="code-block">`;
  external links get `rel="noopener noreferrer"` and LTR direction.
- **CSP on every HTML response**: `default-src 'none'; script-src 'self';
  style-src 'self'; img-src 'self' https: http:; font-src 'self';
  connect-src 'self'; frame-ancestors 'none'; base-uri 'none';
  form-action 'self'` — no inline scripts anywhere; remote images are the one
  deliberate exception (2026-10-20), so Markdown can embed any http(s) image.
  Report images carry `referrerpolicy="no-referrer"`. Plus `nosniff`,
  `Referrer-Policy`, `X-Frame-Options`.
- **Assets**: images verified by magic bytes only (PNG/JPEG/WebP/GIF; SVG
  rejected as an inline image); **downloadable files accept any type**, any
  extension or none (the old extension allowlist was removed 2026-10-20).
  Uploaded files are typed safely at serve time: known code/text extensions →
  `text/plain; charset=utf-8`, everything else (including `.exe`, `.html`,
  extensionless) → `application/octet-stream`, always
  `Content-Disposition: attachment` + `nosniff`, never HTML. Filenames
  sanitized; KV keys are always server-generated UUIDs; values capped at
  25 MiB (KV limit). Uploads require auth + CSRF; sizes capped (10 MB images /
  25 MB files, configurable in `[vars]`). Year-long immutable cache (safe
  because object IDs/keys are never reused).

## 7. Asset lifecycle (deletion is idempotent)

- Upload: validate → **KV put first** (bytes + metadata) → D1 row insert
  (failed insert reverses the put).
- Delete an asset: allowed only with zero `report_assets` references;
  mark `pending_delete` → delete KV object → delete row (each step checks
  state ⇒ retry-safe).
- Permanent report delete: remove links + row, then purge every asset that no
  other report references.
- `POST /api/cleanup` sweeps three failure modes in order: rows stuck in
  `pending_delete`; old (≥1 h) active assets with no references; KV objects
  with no D1 row (guard: stored metadata `created_at` ≥1 h old, so in-flight
  inserts aren't killed during KV's ~60 s global write propagation).

## 8. Renderer / preview parity

`src/lib/renderer.js` is the only Markdown→HTML path. The admin preview
posts Markdown to `/api/preview` and injects the returned HTML; public pages
render server-side with the same module. Same output, same rules, always.
Fenced code is highlighted here too (highlight.js, class-based output), so
colors appear identically in the editor preview and on the public page. This
also gives real SEO and clean Telegram/WhatsApp link previews
(og:title/description/url on report pages), which was the reason for choosing
SSR over a client-side SPA (user-approved deviation from the original doc).

## 9. Frontend (public/, no build step)

- `static/css/base.css` — Persian-first RTL design, CSS logical properties
  only, Vazirmatn self-hosted (woff2 in `static/fonts/`), responsive.
- `static/js/login.js`, `admin.js` (logout + dashboard delete + editor),
  `uploads.js` (editor upload panel: copy URL / درج در متن),
  `admin-assets.js` (library page), `trash.js` (restore/purge/cleanup),
  `report.js` (copy-code with mobile execCommand fallback, lightbox, print/PDF
  handler), `theme.js` (dark/light theme bootstrap + header toggle).
- **Theme system**: dark is the default and is applied by `theme.js` in
  `<head>` before first paint (`data-theme` on `<html>`); the header toggle
  persists the choice in `localStorage` (`gk-theme`). All colors are CSS
  variables in `base.css` — dark + light palettes, teal accent (no blue),
  code blocks use `--code-*` variables (they blend into the dark surface and
  keep the navy look in light mode).
- **Layout**: genuinely two designs, not one stretched. Mobile-first base;
  `≥48em` container 64rem, `≥64em` 74rem (reading column 50rem),
  `≥90em` 80rem. The homepage grid uses `auto-fit`
  (`repeat(auto-fit, minmax(min(100%, 21rem), 1fr))`) so 1–2 reports stretch
  instead of leaving empty tracks, and a lone report becomes a horizontal row
  on desktop (`:only-child`). Gutters are fluid
  (`--gutter: clamp(.9rem, 3.5vw, 1.75rem)`) and exposed as a custom property
  so any future full-width block can deliberately cancel it.
- **Tables are cards at every width**: `.table-wrap` is the card
  (`--surface`, 1px border, radius, internal horizontal scroll) and the
  table's own outer cell border is dropped so the two edges don't double up.
  Phones keep the normal gutters — an earlier full-bleed experiment was
  reverted because edge-to-edge tables/code looked glued to the screen.
- **No page-wide horizontal scroll**: `html { overflow-x: clip }` (unlike
  `hidden`, `clip` is not a scroll container, so the sticky header keeps
  working). Wide tables and code scroll inside their own wrappers; on phones
  tables use denser cells (0.82rem) and `report.js` inserts a Persian
  swipe hint only when a table actually overflows — the fix for people
  pinch-zooming out of the page.
- **Admin upload/asset rows** (`uploads.js`, `admin-assets.js`): each row is
  thumbnail/icon + `.upload-info`/`.asset-meta` (filename, size/usage, URL)
  + `.upload-actions`/`.asset-actions` (buttons). URLs are block-level,
  `min-width: 0`, nowrap + ellipsis. On phones the action buttons become a
  full-width row. List grids use `grid-template-columns: minmax(0, 1fr)` and
  rows have `min-width: 0` — without these, a single nowrap URL sets the grid
  item's min-content width and blows the whole page out to ~800 px (root cause
  of the "file upload page is broken on phone" report). Thumbnails are bounded
  (`max-width` 7rem/100%) and the native file input is themed via
  `::file-selector-button` plus `max-width: 100%`.
  `layout({nav:"admin"})` automatically appends `/static/js/admin.js` (this
  was the fix for dead dashboard delete/logout buttons — the dashboard never
  loaded the script before phase 7).
- All state-changing calls go through fetch with the CSRF headers.

## 10. Local development

```sh
npm install                      # wrangler + markdown-it
cp .dev.vars.example .dev.vars   # then generate values (password in §11)
npx wrangler d1 migrations apply gozaresh-kar-db --local
npx wrangler dev                 # http://localhost:8787
npm test                         # node --test (renderer + assets units)
npm run smoke                    # end-to-end against wrangler dev
                                 # (BASE_URL + SMOKE_PASSWORD env to target prod)
```

## 11. Current dev secrets (.dev.vars, git-ignored)

Dev password: `gk-dev-1234`.
`ADMIN_PASSWORD_HASH=pbkdf2$100000$gWXih76C-MdYZdCkI8gWzw$STwGyNecSUlvhaZdoOSbwwX5Z4V8F7UOPTeE9m0UtZI`
`SESSION_SECRET=t1gJNbMcwJLBvvKtn6ZxXHh8cUP98EGsMSHPDiX5VcA`
(.dev.vars.example documents how to generate fresh values.)

## 12. Phase 7 — UI overhaul (2026-10-20)

- **Dashboard delete/logout fixed**: the dashboard rendered `.btn-delete`
  buttons and `#logout-btn` but never loaded `admin.js`; API-level smoke
  tests had hidden this. Admin pages now get `admin.js` from `layout()`
  automatically; a smoke check asserts the script tag is present.
- **Dark theme default** with a header toggle («روشن»/«تاریک»), remembered in
  localStorage; blue accent replaced with teal everywhere.
- **Public header** no longer shows «ورود مدیر» — admins navigate to `/admin`
  directly (per owner request). The toggle occupies that nav slot.
- **Phone fixes**: `.report-meta` and chips wrap instead of overflowing;
  inline code gets `overflow-wrap: anywhere`; tables have touch scrolling;
  responsive header hides `.brand-sub` under 600px; tap targets are ≥44px;
  copy-code falls back to `execCommand` when mobile browsers deny the
  clipboard API and shows «کپی شد»/«کپی نشد» feedback (no more prompt popup).
- **Desktop home** widened (64/72rem) with auto-fill card grid; reading column
  capped for report pages.
- `.btn-ghost` had never been styled (used across admin pages) — now styled
  for both themes.

## 12b. Phase 8 — phone vs desktop responsive pass (2026-10-20)

Root causes found after phase 7:

- **Desktop home still felt like a phone page**: the listing used
  `auto-fill`, which keeps empty tracks. With one report the single card sat
  in a 21rem track while the rest of the row stayed blank. Switched to
  `auto-fit`; widened the shell to 74rem (80rem ≥1440px); a single report now
  renders as a wide horizontal row.
- **Phone report page needed pinch-zoom-out**: the report has 25 tables
  (three are 16 columns), so wide tables were the real trigger — people
  zoomed out to see them, and in RTL the zoomed-out page collapses into a
  right-hand strip (the "header only in the top-right corner" symptom). Fixes:
  page-level `overflow-x: clip`, denser table cells (0.82rem), smaller phone
  typography (0.97rem body, tighter headings), and a JS-inserted swipe hint
  that only appears for tables that actually overflow.
- **Table/code presentation**: tables and code blocks are inset rounded cards
  on phones and desktop alike (full-bleed was tried, then reverted as ugly);
  the table wrapper draws the card border and outer cell borders are removed
  to keep a single clean edge.
- Fluidity: `--gutter` clamps 0.9→1.75rem, so 320px phones and 1920px screens
  both get sane margins; scrollbars on table/code wrappers are thin and themed.
- Not a page-width bug: Android Chrome (Blink) was in use, not WebKit, so the
  RTL scroll-container bug was ruled out; the overflow guard covers it anyway.
- **Upload page fixed**: the asset/upload list grids sized their single track
  to the item's min-content, and a long `white-space: nowrap` URL made that
  ~798 px wide, expanding the mobile layout viewport (the page rendered as a
  narrow strip, exactly the reported symptom). Fixed with
  `minmax(0, 1fr)` tracks + `min-width: 0` on rows, grouped
  info/actions, bounded thumbnails, and a shrinkable ellipsised URL. Verified
  in Chromium at 320/390 px (plus 768/1440/1920 for the public pages): no
  horizontal overflow anywhere.

## 12c. Phase 9 — syntax highlighting + print/PDF (2026-10-20)

- **Highlighting** runs in the shared renderer (`src/lib/renderer.js`), not in
  the browser: `highlight.js/lib/core` plus 17 registered grammars (c, cpp,
  arduino, python, bash, shell, verilog, vhdl, matlab, json, javascript, sql,
  makefile, diff, yaml, xml, plaintext). Output is class-based (`hljs-*`), so
  the strict CSP is untouched and the copy button still copies raw text.
  Unknown languages (e.g. SPICE netlists) fall back to the old escaped block;
  the fence info string is validated before it reaches the class attribute.
  Token colors are CSS variables tuned to the always-dark code card (they also
  work in light mode because code blocks stay dark there).
- **PDF is the browser's print pipeline**, not a server renderer: a
  «چاپ / PDF» button in the report toolbar calls `window.print()` after fonts
  and lazy images are ready, and temporarily sets `document.title` to the
  report title so the saved file gets a clean name. `@media print` supplies
  `@page { size: A4; margin: 15mm 14mm }`, forces the light palette, hides
  site chrome/toolbar/copy buttons, wraps code instead of clipping it, keeps
  rows/images/code cards unbroken, and repeats table headers on every page.
  A server-side PDF would need Cloudflare Browser Rendering (paid) or an
  external service; JS PDF libs cannot shape Persian RTL text well.
- **Verification**: 30 unit tests; local Chromium (Playwright) screenshots in
  dark/light at 390/1440; print-media screenshots; a real A4 PDF generated
  with `page.pdf()` (MediaBox 594.96×841.92 pt, 4 pages) and rasterized with
  poppler to inspect pagination, repeated table headers, and margins;
  46/46 smoke on local and production.
- **Known limitation**: Chrome/Safari do not let CSS add page numbers to the
  page margin; users can enable the print dialog's header/footer option. PDF
  filename/margins depend on the dialog ("Default" margins respect `@page`).
- Bundle grew to ~500 KB uncompressed (~1.4 MB with sourcemap) after adding
  the grammars — well inside the Workers limit.

## 12d. Phase 10 — remote images + open file types (2026-10-20)

- **Why remote images used to fail**: GitHub raw is hotlinkable (verified
  `200`, `image/png`, `access-control-allow-origin: *`); the block was our CSP
  `img-src 'self'`. Since the site has one trusted admin, that restriction was
  removed for images only: `img-src 'self' https: http:`. Scripts, styles,
  forms, frames and `connect-src` remain locked, so a Markdown/XSS mistake
  still cannot execute or exfiltrate. Renderer adds
  `referrerpolicy="no-referrer"` to report images.
- **Caveats**: hosts with hotlink protection, plain-`http` images on the
  HTTPS site (mixed content), auth-gated URLs, and plain
  `github.com/…/blob/…` links (HTML pages, not images) still fail. Remote
  images need network access at print time; uploads remain the durable option.
- **Files**: the extension allowlist (`FILE_EXTENSIONS`) was removed. Any
  upload, extensionless included, is accepted; the safety property is at
  serve time (`application/octet-stream` + attachment + nosniff for
  everything not known text/code), so an uploaded HTML/executable still cannot
  run. UI hints updated. Images are still magic-byte checked, so SVG is a
  downloadable file, not an inline image.
- **Verification**: 32 unit tests; local Chromium loaded a
  `raw.githubusercontent.com` PNG (`naturalWidth: 288`, no console CSP
  errors) and rendered it in a generated PDF; smoke covers an uploaded
  `.exe`, `.html`, and an extensionless `Makefile`, all served as inert
  attachments; 51/51 smoke locally and on production.

## 13. Open items / manual checklist

- **Deployed (2026-10-20)**: D1 created + migrated, KV namespace created,
  secrets set (`ADMIN_PASSWORD_HASH` for the account owner's chosen password,
  fresh random `SESSION_SECRET`), Worker live at
  https://gozaresh-kar.parsamirzaagha0.workers.dev — 51/51 smoke checks passed
  against production (re-run after phase 10).
- Layout was verified with a local Chromium (Playwright headless, phone
  emulation at 320/390 px and desktop at 768/1440/1920 px): zero horizontal
  overflow and screenshots reviewed for home, report, editor upload panel and
  the asset library. Still worth a real-device pass for clipboard behavior,
  the native file picker, and Persian date rendering.
- If the Chromium binary in a fresh sandbox reports missing `libglib`/font
  errors, the workaround used here was extracting the needed Debian packages
  into `/tmp` and running with `LD_LIBRARY_PATH` + a minimal
  `FONTCONFIG_FILE` — no system install required. `apt-get install
  --download-only chromium` (plus `poppler-utils` to rasterize PDFs)
  resolves every dependency without root.
- **Print check to do once on a real device**: report → «چاپ / PDF» → confirm
  A4 with "Default" margins, header/footer off if unwanted, and that
  multi-page tables repeat their header row.
- The KV-orphan sweep (`sweepOrphanR2Objects`, historical name kept) runs on
  every cleanup call; the "young object spared" sub-branch can't be forced
  locally (KV metadata timestamps can't be backdated) — production cleanup
  returned 200 with no deletions and the age check is five lines of code.
- Local dev note: adding the prod `database_id` to wrangler.toml resets the
  local D1 sandbox identity — re-run `npx wrangler d1 migrations apply
  gozaresh-kar-db --local` once if your local tables vanish.
- `workers.dev` domains are intermittently TLS-reset from Iranian ISPs
  (observed once during prod smoke); if it becomes chronic for the audience,
  attach a custom domain (Workers dashboard → Domains & Routes) — code and
  config need no changes.
- Git: initial commit `0a581ca` on `master` (2026-10-20) contains the full
  project; keep `HANDOFF.md` in the same commit as behavior changes.
- Optional future work (explicitly out of scope for v1): direct-to-storage
  uploads, image processing, multi-user admin, a custom SPICE grammar, a
  one-click PDF (needs paid Browser Rendering or an external service).

## 14. Decisions log (do not re-litigate casually)

1. SSR in the Worker for public pages + preview via API (one renderer, SEO,
   link previews) — user-approved deviation from the initial client-side plan.
2. Plain JS (ESM), no TS, no bundler; markdown-it + highlight.js are the only
   runtime deps and are bundled by Wrangler (no vendored copy needed once SSR
   was chosen). Highlighting is server-side so preview and public pages match.
3. wrangler.toml (TOML) — all needed keys verified against Wrangler 4.x docs;
   re-verify if Wrangler starts gating features behind `wrangler.jsonc`.
4. Slugs: random unambiguous 12-char IDs (user chose "easiest option").
5. Live `wrangler dev` + curl is the testing approach for integration checks;
   `node --test` for renderer/asset units; `tests/smoke.mjs` for lifecycle.
6. Storage is **Workers KV, not R2** (2026-10-20): the account has no payment
   method (user requirement: no-payment architecture), and R2 activation
   requires one. KV trade-offs accepted: 25 MiB max value, eventual
   consistency (~60 s), 1000 free writes/day — all fine for a single-admin
   site's usage pattern.
7. PDF export is client-side print-to-PDF (2026-10-20): an A4 `@media print`
   stylesheet plus a button. No server PDF engine — Workers cannot run
   Chromium on the free plan, and JS PDF libs cannot shape Persian RTL text.
   The print artifact is always light/ink-friendly even when the site is dark.
8. Images may come from any http(s) host (2026-10-20): `img-src 'self'
   https: http:` + `referrerpolicy="no-referrer"`. The rest of the CSP stays
   strict (`default-src 'none'`, self-only scripts/styles/connects). File
   uploads are **not** extension-filtered — any type/extensionless is allowed,
   served only as an inert attachment (octet-stream/plain + nosniff).
