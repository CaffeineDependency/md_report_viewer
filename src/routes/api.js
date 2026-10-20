// API routes: authentication, report CRUD, publish/unpublish, preview.
//
// All state-changing requests require BOTH:
//   1. an Origin header equal to the site origin, and
//   2. the custom request header X-Requested-With: fetch
// combined with the SameSite=Strict session cookie. All report management
// endpoints additionally require a valid session.

import { route } from "../router.js";
import {
  clearLoginFailures,
  clearSessionCookieHeader,
  createSessionToken,
  getLockState,
  isAuthed,
  recordLoginFailure,
  sessionCookieHeader,
  verifyPassword,
} from "../lib/auth.js";
import { json } from "../lib/html.js";
import {
  UUID_RE,
  LOGIN_LOCK_MINUTES,
  LOGIN_MAX_FAILURES,
  MAX_MARKDOWN_KB,
} from "../config.js";
import {
  ValidationError,
  uniqueSlug,
  uuid,
  rebuildReportAssets,
  validateReportInput,
} from "../lib/reports.js";
import { renderMarkdown } from "../lib/renderer.js";
import {
  purgeReport,
  sweepOrphanAssets,
  sweepOrphanR2Objects,
  sweepPendingDelete,
} from "../lib/cleanup.js";

const GENERIC_LOGIN_ERROR = "رمز عبور نادرست است.";
const LOCKED_ERROR =
  "تعداد تلاش‌های ناموفق بیش از حد مجاز است. لطفاً چند دقیقه بعد دوباره تلاش کنید.";
const BAD_REQUEST = "درخواست نامعتبر است.";
const UNAUTHORIZED = "ابتدا وارد حساب مدیر شوید.";
const NOT_FOUND = "گزارش مورد نظر یافت نشد.";
const TOO_LARGE = "حجم درخواست بیش از حد مجاز است.";

const DEFAULT_SESSION_TTL_HOURS = 168;
const MAX_JSON_BODY = MAX_MARKDOWN_KB * 1024 + 16 * 1024; // markdown + meta headroom

/** CSRF guard for state-changing API requests. */
export function mutationAllowed(request) {
  const url = new URL(request.url);
  const origin = request.headers.get("Origin");
  if (!origin) return false;
  let originUrl;
  try {
    originUrl = new URL(origin);
  } catch {
    return false;
  }
  if (originUrl.origin !== url.origin) return false;
  return request.headers.get("X-Requested-With") === "fetch";
}

function clientIp(request) {
  return request.headers.get("CF-Connecting-IP") || "unknown";
}

/** @returns {Promise<Response|null>} null when the session is valid */
async function requireSession(request, env) {
  if (await isAuthed(request, env)) return null;
  return json({ error: UNAUTHORIZED }, { status: 401 });
}

/** Parse a JSON body with an overall size cap. */
async function readJson(request, limit = MAX_JSON_BODY) {
  const text = await request.text();
  if (text.length > limit) {
    throw Object.assign(new Error(TOO_LARGE), { statusCode: 413 });
  }
  return JSON.parse(text);
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

route("POST", "/api/auth/login", async (request, env) => {
  if (!mutationAllowed(request)) {
    return json({ error: BAD_REQUEST }, { status: 403 });
  }
  if (!env.SESSION_SECRET || !env.ADMIN_PASSWORD_HASH) {
    return json(
      { error: "خطای پیکربندی سرور؛ متغیرهای امنیتی تنظیم نشده‌اند." },
      { status: 500 }
    );
  }

  const ip = clientIp(request);
  const lock = await getLockState(env.DB, ip);
  if (lock.locked) {
    return json(
      { error: LOCKED_ERROR },
      { status: 429, headers: { "Retry-After": String(lock.retryAfterSec) } }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: BAD_REQUEST }, { status: 400 });
  }
  const password = body?.password;
  if (typeof password !== "string" || password.length < 1 || password.length > 512) {
    return json({ error: GENERIC_LOGIN_ERROR }, { status: 401 });
  }

  let ok;
  try {
    ok = await verifyPassword(password, env.ADMIN_PASSWORD_HASH);
  } catch {
    return json({ error: "خطای داخلی سرور. بعداً دوباره تلاش کنید." }, { status: 500 });
  }
  if (!ok) {
    await recordLoginFailure(env.DB, ip, LOGIN_MAX_FAILURES, LOGIN_LOCK_MINUTES);
    return json({ error: GENERIC_LOGIN_ERROR }, { status: 401 });
  }

  await clearLoginFailures(env.DB, ip);
  const ttlHours = Number(env.SESSION_TTL_HOURS) || DEFAULT_SESSION_TTL_HOURS;
  const token = await createSessionToken(env.SESSION_SECRET, ttlHours);
  return json(
    { ok: true },
    { headers: { "Set-Cookie": sessionCookieHeader(token, ttlHours) } }
  );
});

route("POST", "/api/auth/logout", async (request, env) => {
  if (!mutationAllowed(request)) {
    return json({ error: BAD_REQUEST }, { status: 403 });
  }
  return json(
    { ok: true },
    { headers: { "Set-Cookie": clearSessionCookieHeader() } }
  );
});

// ---------------------------------------------------------------------------
// Reports CRUD
// ---------------------------------------------------------------------------

const nowIso = () => new Date().toISOString();
const INTERNAL_ERROR = "خطای داخلی سرور. بعداً دوباره تلاش کنید.";

route("POST", "/api/reports", async (request, env) => {
  if (!mutationAllowed(request)) return json({ error: BAD_REQUEST }, { status: 403 });
  const auth = await requireSession(request, env);
  if (auth) return auth;

  try {
    const input = validateReportInput(await readJson(request));
    const id = uuid();
    const slug = await uniqueSlug(env.DB);
    const now = nowIso();

    await env.DB.prepare(
      `INSERT INTO reports (id, slug, title, markdown, status, category, tags, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?)`
    )
      .bind(id, slug, input.title, input.markdown, input.category, input.tags, now, now)
      .run();
    await rebuildReportAssets(env.DB, id, input.markdown);

    return json({ ok: true, id, slug, status: "draft" }, { status: 201 });
  } catch (err) {
    if (err instanceof ValidationError) return json({ error: err.message }, { status: 400 });
    if (err.statusCode === 413) return json({ error: TOO_LARGE }, { status: 413 });
    console.error("create report failed:", err);
    return json({ error: INTERNAL_ERROR }, { status: 500 });
  }
});

route("GET", "/api/reports/:id", async (request, env, params) => {
  const auth = await requireSession(request, env);
  if (auth) return auth;
  if (!UUID_RE.test(params.id)) return json({ error: NOT_FOUND }, { status: 404 });

  const row = await env.DB.prepare(
    `SELECT id, slug, title, markdown, status, category, tags, created_at, updated_at, deleted_at
       FROM reports WHERE id = ?`
  )
    .bind(params.id)
    .first();
  if (!row) return json({ error: NOT_FOUND }, { status: 404 });
  return json({ report: row });
});

route("PUT", "/api/reports/:id", async (request, env, params) => {
  if (!mutationAllowed(request)) return json({ error: BAD_REQUEST }, { status: 403 });
  const auth = await requireSession(request, env);
  if (auth) return auth;
  if (!UUID_RE.test(params.id)) return json({ error: NOT_FOUND }, { status: 404 });

  try {
    const existing = await env.DB.prepare("SELECT id, status FROM reports WHERE id = ?")
      .bind(params.id)
      .first();
    if (!existing) return json({ error: NOT_FOUND }, { status: 404 });
    if (existing.status === "deleted") {
      return json(
        { error: "این گزارش در سطل زباله است؛ برای ویرایش ابتدا آن را بازیابی کنید." },
        { status: 409 }
      );
    }

    const input = validateReportInput(await readJson(request));
    // Identity (id, slug, created_at) is intentionally never touched.
    await env.DB.prepare(
      `UPDATE reports SET title = ?, markdown = ?, category = ?, tags = ?, updated_at = ?
        WHERE id = ?`
    )
      .bind(
        input.title,
        input.markdown,
        input.category,
        input.tags,
        nowIso(),
        params.id
      )
      .run();
    await rebuildReportAssets(env.DB, params.id, input.markdown);

    return json({ ok: true, id: params.id });
  } catch (err) {
    if (err instanceof ValidationError) return json({ error: err.message }, { status: 400 });
    if (err.statusCode === 413) return json({ error: TOO_LARGE }, { status: 413 });
    console.error("update report failed:", err);
    return json({ error: INTERNAL_ERROR }, { status: 500 });
  }
});

/** status transitions: publish (draft|published -> published), unpublish */
async function setStatus(request, env, params, newStatus) {
  if (!mutationAllowed(request)) return json({ error: BAD_REQUEST }, { status: 403 });
  const auth = await requireSession(request, env);
  if (auth) return auth;
  if (!UUID_RE.test(params.id)) return json({ error: NOT_FOUND }, { status: 404 });

  const existing = await env.DB.prepare("SELECT id, status FROM reports WHERE id = ?")
    .bind(params.id)
    .first();
  // A blind UPDATE would otherwise answer changes:0 with a fake ok.
  // 404 = no such report, 409 = exists but is in the trash.
  if (!existing) return json({ error: NOT_FOUND }, { status: 404 });
  if (existing.status === "deleted") {
    return json(
      { error: "این گزارش در سطل زباله است؛ برای ادامه ابتدا آن را بازیابی کنید." },
      { status: 409 }
    );
  }

  const result = await env.DB.prepare(
    `UPDATE reports SET status = ?, updated_at = ?
       WHERE id = ? AND status != 'deleted'`
  )
    .bind(newStatus, nowIso(), params.id)
    .run();
  return json({ ok: true, id: params.id, status: newStatus, changes: result.meta?.changes ?? 0 });
}

route("POST", "/api/reports/:id/publish", (request, env, params) =>
  setStatus(request, env, params, "published")
);
route("POST", "/api/reports/:id/unpublish", (request, env, params) =>
  setStatus(request, env, params, "draft")
);

// ---------------------------------------------------------------------------
// Trash lifecycle: soft delete → restore | permanent delete (+ cleanup sweeper)
// ---------------------------------------------------------------------------

/** Soft delete: report disappears from the public site and dashboard; row and
 *  asset links stay intact so restore is lossless. */
route("DELETE", "/api/reports/:id", async (request, env, params) => {
  if (!mutationAllowed(request)) return json({ error: BAD_REQUEST }, { status: 403 });
  const auth = await requireSession(request, env);
  if (auth) return auth;
  if (!UUID_RE.test(params.id)) return json({ error: NOT_FOUND }, { status: 404 });

  const existing = await env.DB.prepare("SELECT id, status FROM reports WHERE id = ?")
    .bind(params.id)
    .first();
  if (!existing) return json({ error: NOT_FOUND }, { status: 404 });

  const result = await env.DB.prepare(
    `UPDATE reports SET status = 'deleted', deleted_at = ?, updated_at = ?
       WHERE id = ? AND status != 'deleted'`
  )
    .bind(nowIso(), nowIso(), params.id)
    .run();
  return json({ ok: true, id: params.id, changes: result.meta?.changes ?? 0 });
});

/** Restore from trash: comes back as a draft. */
route("POST", "/api/reports/:id/restore", async (request, env, params) => {
  if (!mutationAllowed(request)) return json({ error: BAD_REQUEST }, { status: 403 });
  const auth = await requireSession(request, env);
  if (auth) return auth;
  if (!UUID_RE.test(params.id)) return json({ error: NOT_FOUND }, { status: 404 });

  const existing = await env.DB.prepare("SELECT id, status FROM reports WHERE id = ?")
    .bind(params.id)
    .first();
  if (!existing) return json({ error: NOT_FOUND }, { status: 404 });
  if (existing.status !== "deleted") {
    return json(
      { error: "این گزارش در سطل زباله نیست." },
      { status: 409 }
    );
  }

  const result = await env.DB.prepare(
    `UPDATE reports SET status = 'draft', deleted_at = NULL, updated_at = ?
       WHERE id = ? AND status = 'deleted'`
  )
    .bind(nowIso(), params.id)
    .run();
  return json({ ok: true, id: params.id, changes: result.meta?.changes ?? 0 });
});

/** Permanent delete: row + links gone; R2 bytes removed only for assets no
 *  other report references. Requires the report to be in the trash. */
route("DELETE", "/api/reports/:id/permanent", async (request, env, params) => {
  if (!mutationAllowed(request)) return json({ error: BAD_REQUEST }, { status: 403 });
  const auth = await requireSession(request, env);
  if (auth) return auth;
  if (!UUID_RE.test(params.id)) return json({ error: NOT_FOUND }, { status: 404 });

  const row = await env.DB.prepare(
    "SELECT id, status FROM reports WHERE id = ?"
  )
    .bind(params.id)
    .first();
  if (!row) return json({ error: NOT_FOUND }, { status: 404 });
  if (row.status !== "deleted") {
    return json(
      { error: "برای حذف همیشگی، گزارش باید ابتدا به سطل زباله منتقل شود." },
      { status: 409 }
    );
  }

  const outcome = await purgeReport(env.DB, env.BUCKET, params.id);
  return json({ ok: true, id: params.id, purgedAssets: outcome.purgedAssets });
});

/** Retry-safe sweeper: pending_delete leftovers, old unreferenced assets, and
 *  R2 objects without a D1 row. */
route("POST", "/api/cleanup", async (request, env) => {
  if (!mutationAllowed(request)) return json({ error: BAD_REQUEST }, { status: 403 });
  const auth = await requireSession(request, env);
  if (auth) return auth;

  const pendingDeleted = await sweepPendingDelete(env.DB, env.BUCKET);
  const orphansPurged = await sweepOrphanAssets(env.DB, env.BUCKET);
  const r2OrphansDeleted = await sweepOrphanR2Objects(env.DB, env.BUCKET);
  return json({ ok: true, pendingDeleted, orphansPurged, r2OrphansDeleted });
});

// ---------------------------------------------------------------------------
// Preview — same renderer as the public page
// ---------------------------------------------------------------------------

route("POST", "/api/preview", async (request, env) => {
  const auth = await requireSession(request, env);
  if (auth) return auth;

  try {
    const body = await readJson(request);
    if (typeof body?.markdown !== "string") {
      return json({ error: BAD_REQUEST }, { status: 400 });
    }
    return json({ html: renderMarkdown(body.markdown) });
  } catch (err) {
    if (err.statusCode === 413) return json({ error: TOO_LARGE }, { status: 413 });
    return json({ error: BAD_REQUEST }, { status: 400 });
  }
});
