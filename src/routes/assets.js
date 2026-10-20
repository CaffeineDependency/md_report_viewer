// Asset routes: upload (Worker-mediated to KV), listing with usage counts,
// unreferenced-only deletion, and public serving of /images/* and /files/*.
//
// Uploads are never proxied to the browser as-is: images are verified by
// magic bytes; files by extension allowlist. Everything is size-capped and
// requires an authenticated admin session plus CSRF headers.

import { route } from "../router.js";
import { isAuthed } from "../lib/auth.js";
import { json, redirect } from "../lib/html.js";
import { mutationAllowed } from "./api.js";
import {
  UUID_RE,
} from "../config.js";
import {
  AssetError,
  FILE_EXTENSIONS,
  contentDisposition,
  fileContentType,
  fileKey,
  fileUrl,
  filenameExt,
  imageKey,
  imageUrl,
  sanitizeFilename,
  sniffImage,
} from "../lib/assets.js";

const MB = 1024 * 1024;
const GENERIC = "خطای داخلی سرور. بعداً دوباره تلاش کنید.";
const UNAUTHORIZED = "ابتدا وارد حساب مدیر شوید.";
const BAD_REQUEST = "درخواست نامعتبر است.";

/** @returns {Promise<Response|null>} null when session valid */
async function requireSession(request, env) {
  if (await isAuthed(request, env)) return null;
  return json({ error: UNAUTHORIZED }, { status: 401 });
}

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

route("POST", "/api/assets", async (request, env) => {
  if (!mutationAllowed(request)) return json({ error: BAD_REQUEST }, { status: 403 });
  const auth = await requireSession(request, env);
  if (auth) return auth;

  const maxImageBytes = (Number(env.MAX_IMAGE_MB) || 10) * MB;
  const maxFileBytes = (Number(env.MAX_FILE_MB) || 25) * MB;

  // Cheap early rejection before buffering multipart data.
  const declared = Number(request.headers.get("Content-Length") || 0);
  const overhead = 1 * MB; // multipart framing headroom
  if (declared > maxImageBytes + overhead && declared > maxFileBytes + overhead) {
    return json(
      { error: `حجم فایل بیش از حد مجاز است (حداکثر حجم مجاز را رعایت کنید).` },
      { status: 413 }
    );
  }

  let form;
  try {
    form = await request.formData();
  } catch {
    return json({ error: "داده‌های بارگذاری قابل خواندن نیست." }, { status: 400 });
  }

  const kindRaw = form.get("kind");
  const kind = kindRaw === "image" ? "image" : kindRaw === "file" ? "file" : null;
  if (!kind) {
    return json({ error: "نوع فایل مشخص نشده است." }, { status: 400 });
  }

  const candidate = form.get("file");
  if (!candidate || typeof candidate.arrayBuffer !== "function") {
    return json({ error: "فایلی برای بارگذاری یافت نشد." }, { status: 400 });
  }

  const bytes = new Uint8Array(await candidate.arrayBuffer());
  const clientName = sanitizeFilename(typeof candidate.name === "string" ? candidate.name : "");

  const id = crypto.randomUUID();

  let r2Key;
  let contentType;
  let publicUrl;
  let originalFilename = clientName;

  try {
    if (kind === "image") {
      if (bytes.length > maxImageBytes) {
        throw new AssetError(
          `حجم تصویر بیش از حد مجاز است (حداکثر ${Math.floor(maxImageBytes / MB)} مگابایت).`
        );
      }
      const sniffed = sniffImage(bytes);
      if (!sniffed) {
        throw new AssetError(
          "فرمت تصویر پشتیبانی نمی‌شود؛ فقط PNG، JPEG، WebP و GIF مجاز است."
        );
      }
      r2Key = imageKey(id, sniffed.ext);
      contentType = sniffed.contentType;
      publicUrl = imageUrl(id, contentType);
    } else {
      if (bytes.length > maxFileBytes) {
        throw new AssetError(
          `حجم فایل بیش از حد مجاز است (حداکثر ${Math.floor(maxFileBytes / MB)} مگابایت).`
        );
      }
      const ext = filenameExt(clientName);
      if (!FILE_EXTENSIONS.has(ext)) {
        throw new AssetError(
          "پسوند فایل مجاز نیست؛ در فهرست پسوندهای مجاز فقط انواع پروژه آزمایشگاه و متن مجاز است."
        );
      }
      if (!originalFilename || originalFilename === "file") {
        originalFilename = "project-file" + (ext ? "." + ext : "");
      }
      r2Key = fileKey(id, originalFilename);
      contentType = fileContentType(ext);
      publicUrl = fileUrl(id, originalFilename);
    }

    // Bytes go to KV first; only then is the D1 row created, so a failed put
    // leaves no dangling metadata (sweep-up in /api/cleanup handles a failed
    // row-insert after a successful put).
    await env.BUCKET.put(r2Key, bytes, {
      metadata: {
        kind,
        contentType: contentType.split(";")[0],
        created_at: new Date().toISOString(),
      },
    });
  } catch (err) {
    if (err instanceof AssetError) {
      return json({ error: err.message }, { status: err.statusCode });
    }
    console.error("asset upload failed:", err);
    return json({ error: GENERIC }, { status: 500 });
  }

  try {
    await env.DB.prepare(
      `INSERT INTO assets (id, r2_key, kind, original_filename, content_type, size, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'active', ?)`
    )
      .bind(id, r2Key, kind, originalFilename, contentType, bytes.length, new Date().toISOString())
      .run();
  } catch (err) {
    // Reverse the successful put to avoid an orphaned R2 object.
    await env.BUCKET.delete(r2Key);
    console.error("asset row insert failed:", err);
    return json({ error: GENERIC }, { status: 500 });
  }

  return json(
    {
      ok: true,
      id,
      kind,
      url: publicUrl,
      filename: originalFilename,
      content_type: contentType,
      size: bytes.length,
    },
    { status: 201 }
  );
});

// ---------------------------------------------------------------------------
// Library listing with usage counts
// ---------------------------------------------------------------------------

route("GET", "/api/assets", async (request, env) => {
  const auth = await requireSession(request, env);
  if (auth) return auth;

  const { results } = await env.DB.prepare(
    `SELECT a.id, a.kind, a.original_filename, a.content_type, a.size, a.created_at,
            (SELECT COUNT(*) FROM report_assets ra WHERE ra.asset_id = a.id) AS used_count
       FROM assets a
      WHERE a.status = 'active'
      ORDER BY a.created_at DESC
      LIMIT 200`
  ).all();

  const assets = (results || []).map((a) => ({
    id: a.id,
    kind: a.kind,
    filename: a.original_filename,
    content_type: a.content_type,
    size: a.size,
    created_at: a.created_at,
    used_count: a.used_count,
    url:
      a.kind === "image"
        ? imageUrl(a.id, a.content_type)
        : fileUrl(a.id, a.original_filename),
  }));
  return json({ assets });
});

// ---------------------------------------------------------------------------
// Delete: allowed only while unreferenced; idempotent retry-safe steps
// ---------------------------------------------------------------------------

route("DELETE", "/api/assets/:id", async (request, env, params) => {
  if (!mutationAllowed(request)) return json({ error: BAD_REQUEST }, { status: 403 });
  const auth = await requireSession(request, env);
  if (auth) return auth;
  if (!UUID_RE.test(params.id)) return json({ error: "فایل یافت نشد." }, { status: 404 });

  const row = await env.DB.prepare(
    `SELECT id, r2_key, status FROM assets WHERE id = ? AND status = 'active'`
  )
    .bind(params.id)
    .first();
  if (!row) return json({ error: "فایل یافت نشد یا قبلاً حذف شده است." }, { status: 404 });

  const ref = await env.DB.prepare(
    `SELECT COUNT(*) AS c FROM report_assets WHERE asset_id = ?`
  )
    .bind(params.id)
    .first();
  if ((ref?.c ?? 0) > 0) {
    return json(
      { error: "این فایل در گزارش‌ها استفاده شده است؛ ابتدا رفرنس‌ها را حذف کنید." },
      { status: 409 }
    );
  }

  // 1) mark, 2) delete bytes, 3) delete row — each step is retry-safe.
  await env.DB.prepare(`UPDATE assets SET status = 'pending_delete' WHERE id = ?`)
    .bind(params.id)
    .run();
  await env.BUCKET.delete(row.r2_key);
  await env.DB.prepare(`DELETE FROM assets WHERE id = ?`).bind(params.id).run();

  return json({ ok: true, id: params.id });
});

// ---------------------------------------------------------------------------
// Public serving
// ---------------------------------------------------------------------------

const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";

async function serveAsset(request, env, id, { mode }) {
  if (!UUID_RE.test((id || "").toLowerCase())) return assetNotFound();
  const row = await env.DB.prepare(
    `SELECT r2_key, kind, content_type, size, original_filename
       FROM assets WHERE id = ? AND status = 'active'`
  )
    .bind(id.toLowerCase())
    .first();
  if (!row || row.kind !== (mode === "image" ? "image" : "file")) return assetNotFound();

  const stored = await env.BUCKET.getWithMetadata(row.r2_key, { type: "arrayBuffer" });
  if (!stored || stored.value === null) return assetNotFound();
  const bytes = stored.value;

  const ext = filenameExt(row.original_filename);
  const type =
    mode === "image" ? row.content_type : row.content_type || "application/octet-stream";
  const disposition = contentDisposition(
    mode === "image" ? "inline" : "attachment",
    row.original_filename,
    ext
  );

  return new Response(bytes, {
    status: 200,
    headers: {
      "Content-Type": type,
      "Content-Length": String(bytes.byteLength || row.size),
      "Content-Disposition": disposition,
      "Cache-Control": IMMUTABLE_CACHE,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'",
    },
  });
}

function assetNotFound() {
  return new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", "X-Content-Type-Options": "nosniff" } });
}

// /images/<id>.<ext>
route("GET", "/images/*", async (request, env, params) => {
  const name = params.wildcard[0] || "";
  const id = name.split(".")[0];
  return serveAsset(request, env, id, { mode: "image" });
});

// /files/<id>/<filename>  (filename segment is cosmetic; lookup is by id)
route("GET", "/files/*", async (request, env, params) => {
  const id = params.wildcard[0] || "";
  return serveAsset(request, env, id, { mode: "file" });
});
