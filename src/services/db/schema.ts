/**
 * Canonical SQLite schema + versioned migrations.
 * SCHEMA_SQL is the full shape for new DBs. MIGRATIONS upgrade older files.
 */
import type { SQLiteDatabase } from "expo-sqlite";

/** Bump when adding a migration. Stored in PRAGMA user_version. */
export const SCHEMA_VERSION = 13;

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS subscriptions (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  plan          TEXT,
  category      TEXT,
  payment_method TEXT,
  status        TEXT DEFAULT 'active',
  start_date    TEXT,
  price         REAL NOT NULL,
  price_unknown INTEGER NOT NULL DEFAULT 0,
  currency      TEXT DEFAULT 'USD',
  billing       TEXT NOT NULL,
  frequency     TEXT,
  renewal_date  TEXT,
  color         TEXT,
  icon_key      TEXT,
  created_at    TEXT DEFAULT (datetime('now')),
  updated_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS icon_cache (
  icon_key      TEXT PRIMARY KEY,
  image_data    TEXT,
  source        TEXT DEFAULT 'local',
  original_url  TEXT,
  format        TEXT DEFAULT 'png',
  fallback_tier INTEGER DEFAULT 0,
  original_width INTEGER,
  original_height INTEGER,
  chosen        INTEGER NOT NULL DEFAULT 0,
  updated_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS icon_crawl_queue (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  icon_key          TEXT NOT NULL UNIQUE,
  subscription_id   TEXT,
  attempt_count     INTEGER DEFAULT 0,
  last_attempt_at   TEXT,
  created_at        TEXT DEFAULT (datetime('now'))
);

-- One durable, per-icon-key view of the crawler. Candidate rows themselves
-- remain in icon_crawl_results; this table makes progress and partial results
-- observable without treating a universal URL-history row as ownership.
CREATE TABLE IF NOT EXISTS icon_crawl_sessions (
  icon_key          TEXT PRIMARY KEY,
  status            TEXT NOT NULL DEFAULT 'idle',
  detail            TEXT,
  discovered_count  INTEGER NOT NULL DEFAULT 0,
  downloaded_count  INTEGER NOT NULL DEFAULT 0,
  rejected_count    INTEGER NOT NULL DEFAULT 0,
  deferred_count    INTEGER NOT NULL DEFAULT 0,
  spidered_pages    INTEGER NOT NULL DEFAULT 0,
  started_at        TEXT DEFAULT (datetime('now')),
  updated_at        TEXT DEFAULT (datetime('now')),
  completed_at      TEXT,
  official_domain   TEXT
);
CREATE INDEX IF NOT EXISTS idx_icon_crawl_sessions_status ON icon_crawl_sessions(status);

CREATE TABLE IF NOT EXISTS icon_crawl_results (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  icon_key      TEXT NOT NULL,
  image_data    TEXT,
  source        TEXT,
  format        TEXT DEFAULT 'png',
  original_url  TEXT,
  fallback_tier INTEGER DEFAULT 0,
  original_width INTEGER,
  original_height INTEGER,
  created_at    TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_icon_crawl_results_key ON icon_crawl_results(icon_key);

CREATE TABLE IF NOT EXISTS crawled_urls (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  url          TEXT NOT NULL UNIQUE,
  first_seen   TEXT DEFAULT (datetime('now')),
  last_attempt TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_crawled_urls_url ON crawled_urls(url);

CREATE TABLE IF NOT EXISTS icon_reports (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  icon_key      TEXT NOT NULL,
  report_type   TEXT NOT NULL,
  source        TEXT,
  image_data    TEXT,
  comment       TEXT,
  rejected      INTEGER DEFAULT 0,
  reported_at   TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_icon_reports_key ON icon_reports(icon_key);

CREATE TABLE IF NOT EXISTS preferences (
  key           TEXT PRIMARY KEY,
  value         TEXT NOT NULL
);

INSERT OR IGNORE INTO preferences (key, value) VALUES ('notification_enabled', 'true');

CREATE TABLE IF NOT EXISTS mail_mailboxes (
  id                 TEXT PRIMARY KEY,
  provider_id        TEXT NOT NULL,
  label              TEXT,
  last_message_date  TEXT,
  last_message_id    TEXT,
  parser_version     INTEGER NOT NULL DEFAULT 1,
  created_at         TEXT DEFAULT (datetime('now')),
  updated_at         TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS mail_messages (
  mailbox_id         TEXT NOT NULL,
  message_id         TEXT NOT NULL,
  from_addr          TEXT NOT NULL,
  subject            TEXT NOT NULL,
  date               TEXT NOT NULL,
  body_text          TEXT,
  html               TEXT,
  attachments_json   TEXT,
  classified_json    TEXT NOT NULL,
  parser_version     INTEGER NOT NULL,
  PRIMARY KEY (mailbox_id, message_id)
);
CREATE INDEX IF NOT EXISTS idx_mail_messages_mailbox ON mail_messages(mailbox_id);

CREATE TABLE IF NOT EXISTS sync_metadata (
  id                     INTEGER PRIMARY KEY CHECK (id = 1),
  sync_enabled           INTEGER DEFAULT 0,
  provider               TEXT,
  provider_user_id       TEXT,
  remote_file_id         TEXT,
  remote_file_hash       TEXT,
  remote_file_modified   TEXT,
  last_sync_timestamp    TEXT,
  server_url             TEXT
);
`;

async function tableExists(db: SQLiteDatabase, name: string): Promise<boolean> {
  const rows = await db.getAllAsync<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
    name,
  );
  return rows.length > 0;
}

async function columnNames(
  db: SQLiteDatabase,
  table: string,
): Promise<string[]> {
  const columns = await db.getAllAsync<{ name: string }>(
    `PRAGMA table_info(${table})`,
  );
  return columns.map((c) => c.name);
}

/**
 * Idempotent migrations for DBs created before SCHEMA_SQL included all tables.
 * Order is fixed; each step is safe to re-run.
 */
export const MIGRATIONS: ((db: SQLiteDatabase) => Promise<void>)[] = [
  // 1: icon_crawl_results
  async (db) => {
    if (!(await tableExists(db, "icon_crawl_results"))) {
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS icon_crawl_results (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          icon_key      TEXT NOT NULL,
          image_data    TEXT,
          source        TEXT,
          format        TEXT DEFAULT 'png',
          original_url  TEXT,
          fallback_tier INTEGER DEFAULT 0,
          created_at    TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_icon_crawl_results_key ON icon_crawl_results(icon_key);
      `);
    }
  },
  // 2: crawled_urls
  async (db) => {
    if (!(await tableExists(db, "crawled_urls"))) {
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS crawled_urls (
          id           INTEGER PRIMARY KEY AUTOINCREMENT,
          url          TEXT NOT NULL UNIQUE,
          first_seen   TEXT DEFAULT (datetime('now')),
          last_attempt TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_crawled_urls_url ON crawled_urls(url);
      `);
    }
  },
  // 3: icon_cache columns
  async (db) => {
    const names = await columnNames(db, "icon_cache");
    if (!names.includes("format")) {
      await db.execAsync(
        "ALTER TABLE icon_cache ADD COLUMN format TEXT DEFAULT 'png'",
      );
    }
    if (!names.includes("original_url")) {
      await db.execAsync("ALTER TABLE icon_cache ADD COLUMN original_url TEXT");
    }
    if (!names.includes("fallback_tier")) {
      await db.execAsync(
        "ALTER TABLE icon_cache ADD COLUMN fallback_tier INTEGER DEFAULT 0",
      );
    }
  },
  // 4: queue attempt columns
  async (db) => {
    const names = await columnNames(db, "icon_crawl_queue");
    if (!names.includes("attempt_count")) {
      await db.execAsync(
        "ALTER TABLE icon_crawl_queue ADD COLUMN attempt_count INTEGER DEFAULT 0",
      );
    }
    if (!names.includes("last_attempt_at")) {
      await db.execAsync(
        "ALTER TABLE icon_crawl_queue ADD COLUMN last_attempt_at TEXT",
      );
    }
  },
  // 5: crawl_results dimensions
  async (db) => {
    const names = await columnNames(db, "icon_crawl_results");
    if (!names.includes("original_width")) {
      await db.execAsync(
        "ALTER TABLE icon_crawl_results ADD COLUMN original_width INTEGER",
      );
    }
    if (!names.includes("original_height")) {
      await db.execAsync(
        "ALTER TABLE icon_crawl_results ADD COLUMN original_height INTEGER",
      );
    }
  },
  // 6: icon_cache dimensions
  async (db) => {
    const names = await columnNames(db, "icon_cache");
    if (!names.includes("original_width")) {
      await db.execAsync(
        "ALTER TABLE icon_cache ADD COLUMN original_width INTEGER",
      );
    }
    if (!names.includes("original_height")) {
      await db.execAsync(
        "ALTER TABLE icon_cache ADD COLUMN original_height INTEGER",
      );
    }
  },
  // 7: icon_reports in main schema
  async (db) => {
    if (!(await tableExists(db, "icon_reports"))) {
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS icon_reports (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          icon_key      TEXT NOT NULL,
          report_type   TEXT NOT NULL,
          source        TEXT,
          image_data    TEXT,
          comment       TEXT,
          rejected      INTEGER DEFAULT 0,
          reported_at   TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_icon_reports_key ON icon_reports(icon_key);
      `);
    } else {
      const names = await columnNames(db, "icon_reports");
      if (!names.includes("comment")) {
        await db.execAsync("ALTER TABLE icon_reports ADD COLUMN comment TEXT");
      }
    }
  },
  // 8: dedupe crawl results by (icon_key, original_url) when URL present
  async (db) => {
    // Drop older duplicates (keep highest id per key+url)
    await db.execAsync(`
      DELETE FROM icon_crawl_results
      WHERE original_url IS NOT NULL AND original_url != ''
        AND id NOT IN (
          SELECT MAX(id) FROM icon_crawl_results
          WHERE original_url IS NOT NULL AND original_url != ''
          GROUP BY icon_key, original_url
        );
    `);
    await db.execAsync(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_crawl_results_key_url
      ON icon_crawl_results(icon_key, original_url)
      WHERE original_url IS NOT NULL AND original_url != '';
    `);
  },
  // 9: durable per-icon crawl progress / terminal state.
  async (db) => {
    if (!(await tableExists(db, "icon_crawl_sessions"))) {
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS icon_crawl_sessions (
          icon_key          TEXT PRIMARY KEY,
          status            TEXT NOT NULL DEFAULT 'idle',
          detail            TEXT,
          discovered_count  INTEGER NOT NULL DEFAULT 0,
          downloaded_count  INTEGER NOT NULL DEFAULT 0,
          rejected_count    INTEGER NOT NULL DEFAULT 0,
          deferred_count    INTEGER NOT NULL DEFAULT 0,
          spidered_pages    INTEGER NOT NULL DEFAULT 0,
          started_at        TEXT DEFAULT (datetime('now')),
          updated_at        TEXT DEFAULT (datetime('now')),
          completed_at      TEXT,
          official_domain   TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_icon_crawl_sessions_status
        ON icon_crawl_sessions(status);
      `);
    }
  },
  // 10: email-scan cache (local-only; not cloud-synced).
  async (db) => {
    if (!(await tableExists(db, "mail_mailboxes"))) {
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS mail_mailboxes (
          id                 TEXT PRIMARY KEY,
          provider_id        TEXT NOT NULL,
          label              TEXT,
          last_message_date  TEXT,
          last_message_id    TEXT,
          parser_version     INTEGER NOT NULL DEFAULT 1,
          created_at         TEXT DEFAULT (datetime('now')),
          updated_at         TEXT DEFAULT (datetime('now'))
        );
      `);
    }
    if (!(await tableExists(db, "mail_messages"))) {
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS mail_messages (
          mailbox_id         TEXT NOT NULL,
          message_id         TEXT NOT NULL,
          from_addr          TEXT NOT NULL,
          subject            TEXT NOT NULL,
          date               TEXT NOT NULL,
          body_text          TEXT,
          html               TEXT,
          attachments_json   TEXT,
          classified_json    TEXT NOT NULL,
          parser_version     INTEGER NOT NULL,
          PRIMARY KEY (mailbox_id, message_id)
        );
        CREATE INDEX IF NOT EXISTS idx_mail_messages_mailbox ON mail_messages(mailbox_id);
      `);
    }
  },
  // 11: paid-unknown price ("?") vs known $0.
  async (db) => {
    const names = await columnNames(db, "subscriptions");
    if (!names.includes("price_unknown")) {
      await db.execAsync(
        `ALTER TABLE subscriptions ADD COLUMN price_unknown INTEGER NOT NULL DEFAULT 0;`,
      );
    }
  },
  // 12: persist scan/search official-domain hint on the crawl session.
  async (db) => {
    if (!(await tableExists(db, "icon_crawl_sessions"))) return;
    const names = await columnNames(db, "icon_crawl_sessions");
    if (!names.includes("official_domain")) {
      await db.execAsync(
        `ALTER TABLE icon_crawl_sessions ADD COLUMN official_domain TEXT;`,
      );
    }
  },
  // 13: distinguish crawler-owned vs user/AI-chosen icon_cache rows.
  async (db) => {
    if (!(await tableExists(db, "icon_cache"))) return;
    const names = await columnNames(db, "icon_cache");
    if (!names.includes("chosen")) {
      await db.execAsync(
        `ALTER TABLE icon_cache ADD COLUMN chosen INTEGER NOT NULL DEFAULT 0;`,
      );
    }
    await db.execAsync(
      `UPDATE icon_cache SET chosen = 1
       WHERE lower(IFNULL(source,'')) IN ('ai_upscale','subscription','user');`,
    );
  },
];

export async function applySchema(db: SQLiteDatabase): Promise<void> {
  await db.execAsync(SCHEMA_SQL);
  for (const migrate of MIGRATIONS) {
    await migrate(db);
  }
  await db.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION}`);
}
