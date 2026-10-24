CREATE TABLE IF NOT EXISTS b744ai_manuals (
  id TEXT PRIMARY KEY,
  short_title TEXT NOT NULL,
  title TEXT NOT NULL,
  revision TEXT NOT NULL,
  effective_date TEXT NOT NULL,
  pdf_pages INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  imported_at TEXT NOT NULL
);
CREATE VIRTUAL TABLE IF NOT EXISTS b744ai_pages_fts USING fts5(
  manual_id UNINDEXED,
  pdf_page UNINDEXED,
  printed_label UNINDEXED,
  chapter,
  source_text,
  normalized_text,
  tokenize='trigram'
);

CREATE TABLE IF NOT EXISTS b744ai_daily_usage (
  usage_date TEXT PRIMARY KEY,
  ai_requests INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
