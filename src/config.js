// Global constants. Secrets and size limits that mirror wrangler.toml [vars]
// are read from `env` at request time; only fixed protocol values live here.

export const SESSION_COOKIE = "gk_session";

export const PBKDF2_ITERATIONS = 100000;
export const PBKDF2_KEY_BITS = 256;

export const LOGIN_MAX_FAILURES = 5;
export const LOGIN_LOCK_MINUTES = 15;

// Server-side cap on markdown size (protects the free-plan 10 ms CPU budget).
export const MAX_MARKDOWN_KB = 1024;

// Valid report statuses; also enforced by CHECK constraints in D1 (migration 0001).
export const REPORT_STATUSES = ["draft", "published", "deleted"];

export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
