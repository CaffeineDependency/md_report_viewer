# Deploying گزارش‌کار

The canonical, step-by-step deployment guide now lives in the main README:

**[README.md → Production deployment (from a fresh checkout)](../README.md#production-deployment-from-a-fresh-checkout)**

It covers prerequisites, D1 and KV creation, `wrangler.toml` IDs, remote
migrations, secret generation and `wrangler secret put`, first deploy,
verification (including the smoke suite), custom domains, updating, backups,
rollback, free-tier limits and troubleshooting.

## Production notes

- Live instance:
  <https://gozaresh-kar.parsamirzaagha0.workers.dev>
- The production D1 `database_id` and KV namespace `id` are committed in
  `wrangler.toml` (identifiers, not credentials).
- Production secrets (`ADMIN_PASSWORD_HASH`, `SESSION_SECRET`) are set in
  Cloudflare with `wrangler secret put`; they are never stored in this repo.
- `.dev.vars` holds local development values and is git-ignored.
- Migrations must use `--remote`; without it they only touch the local D1
  sandbox.
- `*.workers.dev` TLS connections are intermittently reset by Iranian ISPs. A
  custom domain on the same Worker is the usual fix and needs no code changes.
- Rollback with `npx wrangler deployments list` and `npx wrangler rollback`;
  D1 and KV data are untouched.
