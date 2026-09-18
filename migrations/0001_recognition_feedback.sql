CREATE TABLE IF NOT EXISTS recognition_feedback (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  image_mime TEXT NOT NULL,
  image_blob BLOB NOT NULL,
  image_bytes INTEGER NOT NULL,
  detected_name TEXT DEFAULT '',
  confirmed_name TEXT NOT NULL,
  source_label TEXT DEFAULT '',
  source_url TEXT DEFAULT '',
  official INTEGER NOT NULL DEFAULT 0,
  confidence REAL NOT NULL DEFAULT 0,
  recognition_source TEXT DEFAULT '',
  candidate_names_json TEXT DEFAULT '[]',
  app_version TEXT DEFAULT 'web-v1'
);

CREATE INDEX IF NOT EXISTS idx_recognition_feedback_created_at
  ON recognition_feedback(created_at);

CREATE INDEX IF NOT EXISTS idx_recognition_feedback_confirmed_name
  ON recognition_feedback(confirmed_name);
