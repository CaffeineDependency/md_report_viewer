# Deploying گزارش‌کار to Cloudflare

This guide takes a fresh checkout to a live site. Commands run from the repo
root with `npm install` done. Verified against Wrangler 4.x — and used to put
this project live at `https://gozaresh-kar.parsamirzaagha0.workers.dev`
(2026-10-20, all 44 smoke checks passing against production).

> Everything here fits Cloudflare's **free tier with no payment method** —
> the storage layer is Workers KV precisely because R2 (which needs a card to
> activate) is not an option on this account. See "Costs & limits" at the end.

---

## 0. Prerequisites

1. A Cloudflare account (the repo owner uses `parsamirzaagha0@gmail.com`).
2. `npm install` in the repo (installs local wrangler + markdown-it).
3. Log in once:
   ```sh
   npx wrangler login      # opens a browser; verify with npx wrangler whoami
   ```

## 1. Create the production D1 database

```sh
npx wrangler d1 create gozaresh-kar-db
```

The output prints a `database_id` (36-char UUID). Paste it into
`wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "gozaresh-kar-db"
database_id = "<paste database_id here>"
```

Then apply the schema — **note `--remote`** (without the flag it touches your
local dev copy instead, which quietly deploys an empty database):

```sh
npx wrangler d1 migrations apply gozaresh-kar-db --remote
```

✅ Verify: `npx wrangler d1 execute gozaresh-kar-db --remote --command "SELECT name FROM sqlite_master WHERE type='table'"` should list `reports`, `assets`, `report_assets`, `login_attempts`.

## 2. Create the production KV namespace (byte storage)

```sh
npx wrangler kv namespace create "gozaresh-kar-assets"
```

The output prints a namespace `id` (32 hex chars). Paste it into
`wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "BUCKET"
id = "<paste namespace id here>"
```

The binding is internal bytes storage — images and project files live here as
KV values (each ≤25 MiB; the app caps sizes below that). **KV is used instead
of R2 on purpose:** R2 activation requires a payment method on the account,
KV does not (Workers free plan). Note KV's ~60 s eventual-consistency window —
a fresh upload can rarely 404 in another region for under a minute.

## 3. Review `wrangler.toml`

- `name = "gozaresh-kar"` → the Worker name (URL: `gozaresh-kar.<account>.workers.dev`).
- `[vars]`: `MAX_IMAGE_MB` / `MAX_FILE_MB` / `SESSION_TTL_HOURS` — defaults are
  fine (10 / 25 / 168).
- `[assets]` binding points at `./public` — no change needed.

## 4. First deploy

```sh
npm run deploy
```

Wrangler uploads the Worker (with markdown-it bundled) and the static files,
and prints the production URL (e.g. `https://gozaresh-kar.<subdomain>.workers.dev`).
The site will serve 500s **until the next step** — expected, secrets aren't set yet.

## 5. Secrets

Never put secret values in `wrangler.toml` (it is committed) or in git.

1. Choose a strong admin password (this is the login at `/login`).
2. Generate the hash — **the command echoes the password hash only; remember
   the password itself, it cannot be recovered**:
   ```sh
   node scripts/hash-password.mjs 'YOUR_STRONG_PASSWORD'
   # -> pbkdf2$100000$xxxx$yyyy
   ```
3. Generate a session-signing key:
   ```sh
   node -e "console.log(crypto.randomBytes(32).toString('base64url'))"
   ```
4. Set both (each prompts for a value; first deploy creates them):
   ```sh
   npx wrangler secret put ADMIN_PASSWORD_HASH   # paste the whole pbkdf2$… line
   npx wrangler secret put SESSION_SECRET        # paste the base64url string
   ```

No redeploy needed — secrets bind to the Worker immediately.

✅ Verify: `npx wrangler secret list` shows both names; the site now returns
200 with the Persian list page.

## 6. Verify the deployment

From a clean browser profile (or `curl`):

| Check | Expected |
|---|---|
| `GET <url>/` | Persian empty list page, `content-security-policy: default-src 'none'; …` |
| `GET <url>/login` | form renders; wrong password → Persian error |
| login + create + upload + publish (via `/admin`) | test report is publicly visible at `/reports/<slug>` |
| temporary asset delete flows | image/file 404 after purge |
| `POST <url>/api/cleanup` (admin) | `{ok:true, ...}`; first run displays sweep counts |

The admin smoke path can be exercised headlessly against production by
`SMOKE_PASSWORD='<your pw>' BASE_URL=<prod url> npm run smoke` **before pointing colleagues at the site**, then
deleting the test report it creates.

## 7. Custom domain (optional, but consider it if the audience is in Iran)

Dashboard → Workers & Pages → `gozaresh-kar` → **Settings → Domains &
Routes** → add the domain/hostname. Cloudflare DNS must manage the zone
(free plan works). HTTPS is automatic.

Note: Persian-ISP DPI is known to intermittently TLS-reset `*.workers.dev`
domains (observed once during this deployment's smoke run). A custom domain
on the same Worker is the usual fix — no code/config changes needed.

## 8. Ongoing maintenance

- **Deploy a change:** `npm run deploy` (assets update automatically).
- **Schema changes:** add `migrations/0002_….sql`, then
  `npx wrangler d1 migrations apply gozaresh-kar-db --remote`.
- **Rotate the admin password:** `node scripts/hash-password.mjs '<new pw>'`
  → `wrangler secret put ADMIN_PASSWORD_HASH`.
- **Revoke all sessions:** `wrangler secret put SESSION_SECRET` with a fresh
  random value (sessions are stateless; this invalidates every cookie).
- **Trash hygiene:** the trash page's cleanup button (or `POST /api/cleanup`)
  finishes failed deletes and removes orphans; monthly is plenty.

## 9. Rollback / pause

- List recent versions: `npx wrangler deployments list`
- Roll back: `npx wrangler rollback` (interactive) — data (D1/KV) is untouched.
- Pause traffic: Dashboard → the Worker → Pause (or undeploy the route).

## 10. Costs & limits (Cloudflare free tier, checked 2026-10)

| Resource | Free allowance | This app's need |
|---|---|---|
| Workers requests | 100k/day | trivial for a personal report site |
| Worker CPU | 10 ms/request | **watch out** — SSR of a ≤1 MB Markdown cap is the designed protection; if a report render grows slow, Workers paid ($5/mo, 30 s CPU) removes all doubt |
| D1 | 5M row reads / 100k row writes daily | fine |
| D1 storage | 5 GB total | reports are text — tiny |
| KV storage | 1 GB-month | fine (files are ≤25 MB each) |
| KV writes | 1,000/day | uploads + edits only — fine for one admin |
| KV reads | 100,000/day | each image/file view costs one read — fine unless the site goes big |
| KV deletes/list | 1,000/day | fine |
| Workers file serving egress | included in Workers requests | no separate egress bill |

The 10 ms CPU limit is the only structural risk; it was accepted at planning
time because Markdown rendering of ≤1 MB documents stays well under it, and
it would be the first thing to revisit with real reports.

## 11. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| 500 on every page right after first deploy | secrets not set yet | §5 |
| All queries fail with `no such table` | migrations applied to the wrong copy | re-run §1 with `--remote` |
| `database_id` mismatch on deploy | wrangler.toml still holds the dev value | paste the prod dashboard ID from §1 |
| Upload 413/400 on huge files | daily cap or `[vars]` limits (10 MB images, 25 MB files) | raise `[vars]` if needed |
| Assets page lists a file that 404s when opened | cleanup still running, KV propagation (~60 s), or browser cache | `POST /api/cleanup` then refresh |
| Persian text misrendered in a report | pasted Markdown contained raw HTML | app escapes it by design; use Markdown syntax instead |

## 12. What is NOT automated (manual steps on a fresh account)

1. `npx wrangler login` (browser flow).
2. (None — KV doesn't need enabling, unlike R2.)
3. Choosing + memorizing the admin password (§5).
4. First manual smoke pass in a real browser (§6).
5. Optional custom domain (§7).
