import { exec } from "./db.js";

export function initSchema(): void {
  exec(`
    CREATE TABLE IF NOT EXISTS experiments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      niche TEXT,
      region TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS videos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filepath_raw TEXT NOT NULL UNIQUE,
      duration_sec REAL NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS clips (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      video_id INTEGER NOT NULL,
      experiment_id INTEGER NOT NULL,
      clip_index INTEGER,
      filepath_clip TEXT NOT NULL,
      start_sec REAL NOT NULL,
      end_sec REAL NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (video_id) REFERENCES videos(id),
      FOREIGN KEY (experiment_id) REFERENCES experiments(id),
      UNIQUE(video_id, start_sec, end_sec)
    );

    CREATE TABLE IF NOT EXISTS hooks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      clip_id INTEGER NOT NULL,
      hook_text TEXT NOT NULL,
      hook_style TEXT NOT NULL,
      generation INTEGER NOT NULL DEFAULT 1,
      parent_hook_id INTEGER,
      source TEXT NOT NULL DEFAULT 'auto',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (clip_id) REFERENCES clips(id),
      FOREIGN KEY (parent_hook_id) REFERENCES hooks(id),
      UNIQUE(clip_id, hook_text)
    );

    CREATE TABLE IF NOT EXISTS variants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      clip_id INTEGER NOT NULL,
      hook_id INTEGER NOT NULL,
      filepath_variant TEXT NOT NULL,
      overlay_style TEXT NOT NULL DEFAULT 'top_center_white_black_stroke',
      status TEXT NOT NULL DEFAULT 'generated',
      generation INTEGER NOT NULL DEFAULT 1,
      parent_variant_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (clip_id) REFERENCES clips(id),
      FOREIGN KEY (hook_id) REFERENCES hooks(id),
      FOREIGN KEY (parent_variant_id) REFERENCES variants(id),
      UNIQUE(clip_id, hook_id, overlay_style)
    );

    CREATE TABLE IF NOT EXISTS captions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      variant_id INTEGER NOT NULL,
      caption_text TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (variant_id) REFERENCES variants(id)
    );

    CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      variant_id INTEGER NOT NULL,
      platform TEXT NOT NULL,
      posted_at TEXT,
      url_optional TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (variant_id) REFERENCES variants(id)
    );

    CREATE TABLE IF NOT EXISTS metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER NOT NULL,
      snapshot_hours INTEGER NOT NULL,
      views INTEGER DEFAULT 0,
      likes INTEGER DEFAULT 0,
      comments INTEGER DEFAULT 0,
      saves INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (post_id) REFERENCES posts(id)
    );

    CREATE TABLE IF NOT EXISTS scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER NOT NULL,
      snapshot_hours INTEGER NOT NULL,
      score_value REAL NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (post_id) REFERENCES posts(id)
    );

    CREATE TABLE IF NOT EXISTS winners (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      clip_id INTEGER NOT NULL,
      variant_id INTEGER NOT NULL,
      snapshot_hours INTEGER NOT NULL,
      rank INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (clip_id) REFERENCES clips(id),
      FOREIGN KEY (variant_id) REFERENCES variants(id)
    );

    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_type TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
    CREATE INDEX IF NOT EXISTS idx_jobs_type ON jobs(job_type);
    CREATE INDEX IF NOT EXISTS idx_variants_status ON variants(status);
    CREATE INDEX IF NOT EXISTS idx_variants_generation ON variants(generation);
    CREATE INDEX IF NOT EXISTS idx_hooks_generation ON hooks(generation);
  `);
}
