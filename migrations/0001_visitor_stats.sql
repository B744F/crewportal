CREATE TABLE IF NOT EXISTS visitor_country_counts (
  country_code TEXT PRIMARY KEY NOT NULL,
  visit_count INTEGER NOT NULL DEFAULT 0,
  last_seen_at TEXT NOT NULL
);
