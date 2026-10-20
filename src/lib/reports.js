// Report identity, validation and the report_assets link table.

import { extractReportAssetRefs } from "./renderer.js";

const SLUG_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"; // no ambiguous chars

export function uuid() {
  return crypto.randomUUID();
}

/** Random, URL-safe, immutable slug; regenerated only if it collides. */
export function randomSlug(length = 12) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let slug = "";
  for (const b of bytes) slug += SLUG_ALPHABET[b % SLUG_ALPHABET.length];
  return slug;
}

export async function uniqueSlug(db) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = randomSlug();
    const row = await db
      .prepare("SELECT 1 FROM reports WHERE slug = ?")
      .bind(slug)
      .first();
    if (!row) return slug;
  }
  // Astronomically unlikely, but fail loudly rather than reuse a slug.
  throw new Error("Could not generate a unique slug");
}

// ------------------------------------------------------------- validation

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ValidationError";
  }
}

/**
 * Normalize/validate report fields from an admin input object.
 * @returns {{title: string, markdown: string, category: string, tags: string}}
 */
export function validateReportInput(body) {
  if (!body || typeof body !== "object") {
    throw new ValidationError("داده‌های گزارش نامعتبر است.");
  }
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const markdown = typeof body.markdown === "string" ? body.markdown : "";
  const category = typeof body.category === "string" ? body.category.trim() : "";
  const tags = typeof body.tags === "string" ? body.tags.trim() : "";

  if (title.length < 1 || title.length > 200) {
    throw new ValidationError("عنوان باید بین ۱ تا ۲۰۰ نویسه باشد.");
  }
  if (markdown.length < 1 || markdown.length > MAX_MARKDOWN_LENGTH) {
    throw new ValidationError(
      "متن گزارش خالی است یا از حداکثر مجاز گزارش فراتر رفته است."
    );
  }
  if (category.length > 60) {
    throw new ValidationError("دسته‌بندی حداکثر ۶۰ نویسه است.");
  }
  if (tags.length > 200) {
    throw new ValidationError("برچسب‌ها حداکثر ۲۰۰ نویسه است.");
  }
  return {
    title,
    markdown,
    category: category || null,
    tags: parseTags(tags),
  };
}

const MAX_MARKDOWN_LENGTH = 1024 * 1024; // 1 MB

/**
 * Store comma-separated tags: trimmed, deduplicated, max 12.
 */
export function parseTags(input) {
  const seen = new Set();
  for (const raw of input.split(/[،,]/)) {
    const tag = raw.trim();
    if (tag && tag.length <= 40) seen.add(tag);
    if (seen.size >= 12) break;
  }
  return [...seen].join(",");
}

// ------------------------------------------------------ report_assets link

/**
 * Rebuild the report_assets link set for a report by scanning its markdown.
 * Idempotent: deletes the old set and re-inserts only references to assets
 * that actually exist.
 */
export async function rebuildReportAssets(db, reportId, markdown) {
  const refs = extractReportAssetRefs(markdown);

  let assetIds = [];
  if (refs.length > 0) {
    const placeholders = refs.map(() => "?").join(",");
    const { results } = await env_queryExistingAssets(db, placeholders, refs);
    assetIds = results.map((r) => r.id);
  }

  const statements = [
    db.prepare("DELETE FROM report_assets WHERE report_id = ?").bind(reportId),
  ];
  for (const assetId of assetIds) {
    statements.push(
      db
        .prepare("INSERT INTO report_assets (report_id, asset_id) VALUES (?, ?)")
        .bind(reportId, assetId)
    );
  }
  await db.batch(statements);
}

function env_queryExistingAssets(db, placeholders, refs) {
  return db
    .prepare(`SELECT id FROM assets WHERE id IN (${placeholders})`)
    .bind(...refs)
    .all();
}
