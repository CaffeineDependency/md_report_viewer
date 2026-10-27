# گزارش‌کار (Gozaresh-Kar)

A Persian, RTL, single-admin laboratory-report repository running on
Cloudflare Workers. Reports are written in Markdown — usually produced outside
the app by AI assistants or people — and the site renders, publishes, archives
and serves their images and project files. Public visitors get fast
server-rendered pages; one admin manages everything behind a password.

- **Live site:** <https://gozaresh-kar.parsamirzaagha0.workers.dev>
- **Persian project report (non-technical):** [REPORT.md](REPORT.md)
- **Architecture, history and maintainer notes:** [HANDOFF.md](HANDOFF.md)
- **Short deployment pointer:** [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)

## Contents

- [Features](#features)
- [Tech stack](#tech-stack)
- [Quick start (local)](#quick-start-local)
- [Production deployment](#production-deployment-from-a-fresh-checkout)
- [Updating, backups and rollback](#updating-backups-and-rollback)
- [Scripts](#scripts)
- [Configuration reference](#configuration-reference)
- [Project layout](#project-layout)
- [Data model](#data-model)
- [Security notes](#security-notes)
- [Limits and costs](#limits-and-costs)
- [Troubleshooting](#troubleshooting)

## Features

- **Reports:** write or paste Markdown, preview with the same renderer used by
  the public site, categories, comma-separated tags, publish/unpublish, trash
  with restore, and permanent delete that also cleans up unreferenced files.
- **Editor quality of life:** a refresh-preview button, a preview pane that
  scrolls like the Markdown editor, and a local-draft recovery button for work
  lost to an accidental reload.
- **Assets:** image uploads (PNG/JPEG/WebP/GIF, verified by magic bytes) and
  **any downloadable file** — any extension or none at all (PDF, ZIP, source,
  Proteus projects, extensionless data files, …) — stored in Workers KV.
  Downloads are always attachments with a non-executable content type and
  `nosniff`, so HTML or executables cannot run.
- **Remote images:** Markdown may embed images from any `https`/`http` host
  (GitHub raw, image CDNs, etc.); they render in preview, public pages and
  PDFs, with `referrerpolicy="no-referrer"`.
- **Persian-first:** RTL layout, self-hosted Vazirmatn font, Jalali dates,
  Persian UI strings and error messages.
- **Themes:** dark by default with a header toggle (choice remembered); teal
  accent in both palettes.
- **Responsive by design:** purpose-built phone and desktop layouts, inset
  rounded table/code cards that scroll inside themselves, and ≥44px tap
  targets on phones.
- **Readable code:** fenced blocks are highlighted server-side (C, C++,
  Arduino, Python, Bash/Shell, Verilog, VHDL, Matlab, JSON, JavaScript, SQL,
  Makefile, diff, YAML, XML) with IDE-style colors in both themes; unknown
  languages stay plain, and the copy button copies the raw text.
- **Print / PDF:** every report has a «چاپ / PDF» button that opens the
  browser print dialog with an A4 page, 15mm/14mm margins, a light
  ink-friendly layout, colored code, table headers repeated on each page, and
  long code blocks that paginate line by line. Choose "Save as PDF" there.
- **Search:** title/tag substring search and category chips on the homepage.
- **Security:** PBKDF2 password hash, signed stateless session cookie, CSRF
  protection on all mutations, strict CSP (`default-src 'none'`; no inline
  scripts), login rate-limiting, MIME-safe serving with `nosniff`, and
  `Content-Disposition: attachment` for files.

## Tech stack

| Layer | Choice |
|---|---|
| Runtime | Cloudflare Workers (ES modules, `src/index.js`) |
| Public pages | Server-side rendered in the Worker (SEO + link previews) |
| Database | Cloudflare D1 (SQLite) for reports, asset metadata, links, login attempts |
| Byte storage | Workers KV (`BUCKET`) for image/file contents |
| Static files | Cloudflare Static Assets from `public/` (CSS, JS, fonts, favicon) |
| Markdown | `markdown-it` (shared renderer) + `highlight.js` server-side |
| Frontend | Plain JavaScript and CSS, no framework, no build step |
| Tooling | Wrangler 4, Node's built-in test runner |

There is no bundler step: Wrangler bundles the Worker and its dependencies,
while `public/` is uploaded as static assets.

## Quick start (local)

### Prerequisites

- Node.js 20 or newer (Node 22 recommended)
- npm
- A Cloudflare account is **not** required to run locally
- `npm install`

### 1. Install and configure local secrets

```sh
npm install
cp .dev.vars.example .dev.vars
```

Generate the two values and paste them into `.dev.vars`:

```sh
node scripts/hash-password.mjs 'my-dev-password'                   # ADMIN_PASSWORD_HASH
node -e "console.log(crypto.randomBytes(32).toString('base64url'))" # SESSION_SECRET
```

`.dev.vars` is git-ignored — never commit it. `.dev.vars.example` only
contains placeholders and is safe to commit.

### 2. Create the local database and run

```sh
npx wrangler d1 migrations apply gozaresh-kar-db --local
npm run dev
```

Open <http://localhost:8787> and log in at `/login` with the password you
hashed above.

If your local tables ever vanish, re-run the migrations command with
`--local`; adding a production `database_id` to `wrangler.toml` can reset the
local D1 sandbox identity.

### 3. Run the tests

```sh
npm test
```

This runs the renderer and asset unit tests (32 checks).

With `wrangler dev` running, run the end-to-end suite:

```sh
SMOKE_PASSWORD='my-dev-password' npm run smoke
```

The smoke suite creates a temporary report and uploads, then deletes them. It
requires `SMOKE_PASSWORD` and, optionally, `BASE_URL` (default
`http://localhost:8787`).

## Production deployment (from a fresh checkout)

Everything below fits Cloudflare's free plan with **no payment method**. The
storage layer is Workers KV instead of R2 precisely because R2 activation
requires a card on this account.

### 0. Prerequisites

1. A Cloudflare account.
2. Node.js 20+ and `npm install` in the repository.
3. Wrangler authenticated:

   ```sh
   npx wrangler login
   npx wrangler whoami
   ```

### 1. Create the production D1 database

```sh
npx wrangler d1 create gozaresh-kar-db
```

The command prints a `database_id` (a 36-character UUID). Paste it into
`wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "gozaresh-kar-db"
database_id = "<paste database_id here>"
migrations_dir = "migrations"
```

Apply the schema to the **remote** database. Without `--remote`, the command
only touches your local dev copy and the deployed site will return
`no such table` errors:

```sh
npx wrangler d1 migrations apply gozaresh-kar-db --remote
```

Verify the tables:

```sh
npx wrangler d1 execute gozaresh-kar-db --remote \
  --command "SELECT name FROM sqlite_master WHERE type='table'"
```

You should see `reports`, `assets`, `report_assets`, `login_attempts`, plus
D1's migration bookkeeping tables.

### 2. Create the production KV namespace

```sh
npx wrangler kv namespace create "gozaresh-kar-assets"
```

Paste the printed namespace `id` (32 hex characters) into `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "BUCKET"
id = "<paste namespace id here>"
```

KV stores image and file bytes under server-generated keys.
`database_id` and KV `id` are account identifiers, not credentials; they are
normally safe to commit.

### 3. Review `wrangler.toml`

- `name = "gozaresh-kar"` — the Worker name, which determines the
  `<name>.<account>.workers.dev` URL.
- `[vars]` — size limits and session lifetime. Defaults are fine:
  `MAX_IMAGE_MB=10`, `MAX_FILE_MB=25`, `SESSION_TTL_HOURS=168`.
- `[assets]` — points at `./public`; no change needed.
- `run_worker_first` — the list of dynamic paths served by the Worker. Static
  CSS/JS/fonts bypass the Worker entirely.

If you use a different Worker name, update the smoke/verification URLs
accordingly.

### 4. Generate secrets

Choose a strong admin password and remember it; only its hash is stored and it
cannot be recovered.

```sh
node scripts/hash-password.mjs 'YOUR_STRONG_PASSWORD'
# -> pbkdf2$100000$...
node -e "console.log(crypto.randomBytes(32).toString('base64url'))"
# -> session-signing key
```

Never put these values in `wrangler.toml`, README, or any committed file.
They belong in Cloudflare secrets (production) or `.dev.vars` (local).

### 5. Deploy

```sh
npm run deploy
```

Wrangler uploads the Worker bundle, the static assets, and the bindings
configuration, then prints the production URL. A brand-new deployment returns
500s until the secrets below are set — that is expected.

### 6. Set the production secrets

```sh
npx wrangler secret put ADMIN_PASSWORD_HASH   # paste the whole pbkdf2$... value
npx wrangler secret put SESSION_SECRET        # paste the base64url value
```

Secrets bind immediately; no redeploy is needed. Confirm with:

```sh
npx wrangler secret list
```

The site should now return 200 and show the Persian homepage.

### 7. Verify the deployment

Manual checks from a clean browser profile:

| Check | Expected |
|---|---|
| `GET <url>/` | Persian homepage and a strict `content-security-policy` header |
| `GET <url>/login` | login form; a wrong password shows a Persian error |
| login, create a report, upload, publish | the report appears at `/reports/<slug>` |
| delete an unused asset | it returns 404 after deletion |
| `POST <url>/api/cleanup` (as admin) | `{ok:true, ...}` with sweep counts |

Automated end-to-end check against production:

```sh
BASE_URL='https://<your-worker-url>' SMOKE_PASSWORD='YOUR_STRONG_PASSWORD' npm run smoke
```

The smoke suite creates a temporary report/uploads and purges them. Run it
before sharing the link with colleagues, and confirm the temporary report is
gone afterwards.

### 8. Optional custom domain

Workers dashboard → your Worker → **Settings → Domains & Routes** → add the
hostname. Cloudflare DNS must manage the zone (the free plan is enough); HTTPS
is automatic and no code changes are required.

Iranian ISPs intermittently reset TLS connections to `*.workers.dev` domains.
If that becomes chronic for your audience, a custom domain on the same Worker
is the usual fix.

## Updating, backups and rollback

### Deploy a change

```sh
npm test
npm run deploy
```

Static assets are re-uploaded automatically.

### Change the database schema

Add `migrations/0002_....sql`, then:

```sh
npx wrangler d1 migrations apply gozaresh-kar-db --remote
```

### Rotate the admin password

```sh
node scripts/hash-password.mjs 'NEW_PASSWORD'
npx wrangler secret put ADMIN_PASSWORD_HASH
```

### Revoke all sessions

Sessions are stateless. Setting a fresh `SESSION_SECRET` invalidates every
existing cookie:

```sh
npx wrangler secret put SESSION_SECRET
```

### Backups

- **Database metadata:** export D1 before risky changes:

  ```sh
  npx wrangler d1 export gozaresh-kar-db --remote --output=backup.sql
  ```

- **Files/images:** stored in KV. There is no simple one-click full KV export,
  so keep the original uploads somewhere safe as well.
- **Content:** reports are Markdown in D1; the export above contains them.

### Cleanup

The trash page has a cleanup button (`POST /api/cleanup`) that finishes failed
deletes and removes old unreferenced assets. Running it monthly is plenty.

### Rollback / pause

```sh
npx wrangler deployments list
npx wrangler rollback        # interactive
```

Rolling back the Worker does not touch D1 or KV data. To stop traffic, use the
dashboard's Pause/undeploy controls.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | `wrangler dev` on <http://localhost:8787> |
| `npm test` | unit tests (Markdown renderer, asset validation) |
| `SMOKE_PASSWORD='<pw>' npm run smoke` | 51-check end-to-end suite against a running instance; add `BASE_URL` to target production |
| `npm run deploy` | deploy Worker + assets + bindings to Cloudflare |
| `npm run d1:migrate:local` | apply D1 migrations locally |
| `npm run d1:migrate:remote` | apply D1 migrations to production |
| `npm run hash-password -- '<pw>'` | generate `ADMIN_PASSWORD_HASH` (same as `node scripts/hash-password.mjs '<pw>'`) |

## Configuration reference

### Bindings (`wrangler.toml`)

| Binding | Kind | Purpose |
|---|---|---|
| `DB` | D1 `gozaresh-kar-db` | reports, assets, report_assets, login_attempts |
| `BUCKET` | Workers KV namespace | image/file bytes (`images/<uuid>.<ext>`, `files/<uuid>/<name>`) |
| `ASSETS` | Static Assets `./public` | CSS, JS, fonts, favicon |

### Non-secret variables (`[vars]`)

| Variable | Default | Meaning |
|---|---|---|
| `MAX_IMAGE_MB` | `10` | maximum uploaded image size |
| `MAX_FILE_MB` | `25` | maximum downloadable file size (KV hard limit) |
| `SESSION_TTL_HOURS` | `168` | admin session lifetime (7 days) |

### Secrets (never committed)

| Secret | Set with | Local equivalent |
|---|---|---|
| `ADMIN_PASSWORD_HASH` | `npx wrangler secret put ADMIN_PASSWORD_HASH` | `.dev.vars` |
| `SESSION_SECRET` | `npx wrangler secret put SESSION_SECRET` | `.dev.vars` |

`.dev.vars` and `.env*` are git-ignored. Only `.dev.vars.example` with
placeholders is tracked. If the repository is ever made public, treat any
value that ever appeared in a commit as compromised and rotate it.

## Project layout

```
migrations/0001_init.sql   D1 schema (reports, assets, report_assets, login_attempts)
src/index.js               Worker entry: routing + Persian 404/500 pages
src/router.js              tiny router (params, wildcards, HEAD fallback)
src/routes/                public | admin pages | api | assets (upload/serve)
src/lib/                   renderer (Markdown to safe HTML), reports, assets,
                           auth (PBKDF2/session/rate-limit), cleanup, html, persian
src/config.js              protocol constants and validation limits
public/                    static assets directory (css/js/fonts, no build step)
public/static/js/          theme, login, editor, uploads, assets, trash, report
scripts/hash-password.mjs  password-hash generator (Node-compatible WebCrypto)
tests/                     renderer/assets unit tests + smoke.mjs end-to-end
docs/DEPLOYMENT.md         short pointer to this deployment guide
REPORT.md                  Persian, non-technical project report
HANDOFF.md                 architecture, phase history and maintainer checklist
```

## Data model

`reports` ↔ `report_assets` ↔ `assets`.

- `reports` stores title, Markdown (≤1 MB), status (`draft` / `published` /
  `deleted`), category, tags, timestamps, and an immutable random 12-character
  slug.
- `assets` stores metadata for each image/file; bytes live in KV under
  server-generated keys.
- `report_assets` is rebuilt on every save by scanning the Markdown for
  `/images/<uuid>...` and `/files/<uuid>/...` references.

Deleting a report purges bytes that no other report references. The
`POST /api/cleanup` sweeper is retry-safe for partial failures.

## Security notes

- **Single admin**, password verified against a salted PBKDF2-SHA256 hash
  (100k iterations) with a constant-time comparison.
- **Stateless sessions:** HMAC-SHA256-signed cookie (`HttpOnly; Secure;
  SameSite=Strict`), 7-day TTL by default. Rotate `SESSION_SECRET` to revoke
  all sessions.
- **CSRF:** every mutation requires a matching `Origin` and the
  `X-Requested-With: fetch` header, on top of SameSite=Strict.
- **Rate limiting:** five failed logins lock that IP for 15 minutes, tracked in
  D1.
- **Rendering:** raw HTML in Markdown is escaped; only Markdown constructs are
  rendered. Links allow `http:`, `https:`, `mailto:`, same-site paths, and
  anchors.
- **CSP:** `default-src 'none'` with self-only scripts, styles, fonts and
  connects. Remote images are the one deliberate exception (`img-src` allows
  http/https), because reports embed screenshots and schematics.
- **Uploads:** images are verified by magic bytes (SVG is not an inline
  image); any file type is accepted but always served as an inert attachment
  with `nosniff` and a non-HTML content type.
- **Secrets:** only in `.dev.vars` (local, ignored) and Cloudflare secrets
  (production). `.env*`, `.dev.vars*`, `*.pem` and `*.key` are ignored.

## Limits and costs

Free-tier allowances checked for this project (Cloudflare, 2026):

| Resource | Free allowance | This app's need |
|---|---|---|
| Workers requests | 100k/day | trivial for a personal report site |
| Worker CPU | 10 ms/request | the 1 MB Markdown cap is the protection; paid Workers removes doubt |
| D1 | 5M row reads / 100k row writes daily, 5 GB | reports are text — tiny |
| KV storage | 1 GB-month | fine (files ≤25 MB each) |
| KV writes | 1,000/day | uploads and edits only — fine for one admin |
| KV reads | 100,000/day | one per image/file view |
| KV deletes/list | 1,000/day | fine for normal use |

Hard limits by design:

- Markdown ≤ 1 MB, images ≤ 10 MB, files ≤ 25 MB. 25 MB is also KV's maximum
  value size, so it cannot be raised while assets live in KV.
- Larger files: host them elsewhere (for example Google Drive with
  "anyone with the link") and link them from the Markdown. Remote images can
  be embedded, but many hosts block hotlinking; uploading is the most reliable
  option.
- Single admin, no multi-user, no comments, no AI integration.
- PDF export uses the browser's print dialog; there is no server-side PDF
  engine.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| 500 on every page right after first deploy | secrets not set yet | set `ADMIN_PASSWORD_HASH` and `SESSION_SECRET` (step 6) |
| All queries fail with `no such table` | migrations applied to the local copy | re-run step 1 with `--remote` |
| `database_id` mismatch on deploy | `wrangler.toml` still has the dev/placeholder ID | paste the production ID from step 1 |
| Upload 413/400 on large files | size limits or KV's 25 MB ceiling | raise `[vars]` where possible, or host the file elsewhere |
| Asset appears in the library but 404s | cleanup in progress, KV propagation (~60 s), or browser cache | run cleanup, wait a minute, then refresh |
| Persian text looks wrong in a report | raw HTML was pasted into the Markdown | raw HTML is escaped by design; use Markdown syntax |
| `SMOKE_PASSWORD is required` | smoke run without the password | `SMOKE_PASSWORD='<pw>' npm run smoke` |
| Login form works but sessions expire quickly | `SESSION_TTL_HOURS` lowered, or `SESSION_SECRET` rotated | expected after rotation; log in again |
| `workers.dev` TLS resets in Iran | ISP-level filtering | attach a custom domain to the same Worker |

## Documentation map

| File | Audience | Contents |
|---|---|---|
| `README.md` | developers and operators | setup, full deployment guide, configuration, limits |
| `REPORT.md` | non-technical readers (Persian) | what the project is, how it works, deployment in plain language |
| `HANDOFF.md` | maintainers/agents | architecture details, phase history, decisions, open items |
| `docs/DEPLOYMENT.md` | operators | short pointer to this guide plus production notes |
