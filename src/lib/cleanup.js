// Asset lifecycle: trash-safe, idempotent purge steps.
//
// Invariant: an R2 object is deleted only after its D1 row is marked
// 'pending_delete'; the D1 row is removed only after the object is gone.
// Every step checks current state first, so re-running any sweep after a
// partial failure always converges (no silent orphans, no double deletes).

const ASSET_GRACE_MS = 60 * 60 * 1000; // 1 hour: young rows/objects are spared

/**
 * Idempotently remove one asset: mark pending_delete, delete R2 bytes, delete
 * the D1 row. Safe to call for missing assets or already-pending ones.
 * @returns {Promise<"purged"|"missing">}
 */
export async function purgeAsset(db, bucket, assetId) {
  const row = await db
    .prepare("SELECT id, r2_key, status FROM assets WHERE id = ?")
    .bind(assetId)
    .first();
  if (!row) return "missing";

  if (row.status !== "pending_delete") {
    await db.prepare("UPDATE assets SET status = 'pending_delete' WHERE id = ?")
      .bind(assetId)
      .run();
  }
  await bucket.delete(row.r2_key);
  await db.prepare("DELETE FROM assets WHERE id = ?").bind(assetId).run();
  return "purged";
}

/** Assets stuck in pending_delete (failed mid-purge) → finish the job. */
export async function sweepPendingDelete(db, bucket) {
  const { results } = await db
    .prepare("SELECT id FROM assets WHERE status = 'pending_delete'")
    .all();
  let purged = 0;
  for (const row of results || []) {
    if ((await purgeAsset(db, bucket, row.id)) === "purged") purged++;
  }
  return purged;
}

/** Old, active assets with zero report references → purge. */
export async function sweepOrphanAssets(db, bucket) {
  const cutoff = new Date(Date.now() - ASSET_GRACE_MS).toISOString();
  const { results } = await db
    .prepare(
      `SELECT a.id FROM assets a
        WHERE a.status = 'active'
          AND a.created_at < ?
          AND (SELECT COUNT(*) FROM report_assets ra WHERE ra.asset_id = a.id) = 0`
    )
    .bind(cutoff)
    .all();
  let purged = 0;
  for (const row of results || []) {
    if ((await purgeAsset(db, bucket, row.id)) === "purged") purged++;
  }
  return purged;
}

/**
 * R2-free object storage: Cloudflare KV (binding BUCKET).
 * Objects live under the same key scheme (images/<uuid>.<ext>,
 * files/<uuid>/<name>) with {kind, contentType, created_at} metadata.
 */

/**
 * KV objects with no D1 row (crash between put and insert) → delete.
 * Keys created after the cutoff are left alone: their row insert may still
 * be in flight (and KV writes settle within ~60s globally).
 */
export async function sweepOrphanR2Objects(db, bucket) {
  const cutoff = Date.now() - ASSET_GRACE_MS;
  let deleted = 0;
  let cursor;

  do {
    const listing = cursor
      ? await bucket.list({ cursor })
      : await bucket.list();

    for (const key of listing.keys || []) {
      const createdAt = key.metadata?.created_at
        ? Date.parse(key.metadata.created_at)
        : 0;
      // Unknown metadata (foreign keys) uses 0 → treated as old.
      if (createdAt && createdAt > cutoff) continue;
      const row = await db
        .prepare("SELECT id FROM assets WHERE r2_key = ?")
        .bind(key.name)
        .first();
      if (!row) {
        await bucket.delete(key.name);
        deleted++;
      }
    }
    cursor = listing.list_complete ? undefined : listing.cursor;
  } while (cursor);

  return deleted;
}

/**
 * Permanently remove a (soft-deleted) report: drop its links and row, then
 * purge every asset that is now referenced by no other report.
 * @returns {Promise<{purgedAssets: number}>}
 */
export async function purgeReport(db, bucket, reportId) {
  const { results } = await db
    .prepare("SELECT asset_id FROM report_assets WHERE report_id = ?")
    .bind(reportId)
    .all();

  await db.batch([
    db.prepare("DELETE FROM report_assets WHERE report_id = ?").bind(reportId),
    db.prepare("DELETE FROM reports WHERE id = ?").bind(reportId),
  ]);

  let purgedAssets = 0;
  for (const row of results || []) {
    const ref = await db
      .prepare("SELECT COUNT(*) AS c FROM report_assets WHERE asset_id = ?")
      .bind(row.asset_id)
      .first();
    if ((ref?.c ?? 0) === 0) {
      if ((await purgeAsset(db, bucket, row.asset_id)) === "purged") purgedAssets++;
    }
  }
  return { purgedAssets };
}
