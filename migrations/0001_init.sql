-- Initial schema for the lab report repository.
-- All timestamps are stored as UTC ISO-8601 strings.

CREATE TABLE reports (
  id         TEXT PRIMARY KEY,                        -- uuid
  slug       TEXT NOT NULL UNIQUE,                    -- immutable public identity
  title      TEXT NOT NULL,
  markdown   TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'draft'
             CHECK (status IN ('draft', 'published', 'deleted')),
  category   TEXT,
  tags       TEXT,                                    -- comma-separated
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE INDEX idx_reports_public  ON reports (status, created_at DESC);
CREATE INDEX idx_reports_deleted ON reports (deleted_at);

-- Uploaded bytes always live in R2 (`r2_key`); D1 only holds metadata.
CREATE TABLE assets (
  id                TEXT PRIMARY KEY,                  -- uuid; used in public URLs
  r2_key            TEXT NOT NULL UNIQUE,
  kind              TEXT NOT NULL CHECK (kind IN ('image', 'file')),
  original_filename TEXT NOT NULL,
  content_type      TEXT NOT NULL,
  size              INTEGER NOT NULL,
  status            TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'pending_delete')),
  created_at        TEXT NOT NULL
);

CREATE INDEX idx_assets_status ON assets (status);

-- Link table rebuilt on every report save by scanning the markdown.
CREATE TABLE report_assets (
  report_id TEXT NOT NULL REFERENCES reports (id) ON DELETE CASCADE,
  asset_id  TEXT NOT NULL REFERENCES assets (id)  ON DELETE CASCADE,
  PRIMARY KEY (report_id, asset_id)
);

CREATE INDEX idx_report_assets_asset ON report_assets (asset_id);

-- Simple login rate limiting (single admin account).
CREATE TABLE login_attempts (
  ip           TEXT PRIMARY KEY,
  failed_count INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  updated_at   TEXT NOT NULL
);
