/**
 * SQLite database layer using better-sqlite3.
 *
 * Manages schema creation, connection lifecycle, and provides a
 * prepared-statement wrapper for tender and run-log operations.
 */

import Database from 'better-sqlite3';
import type { Database as DbType } from 'better-sqlite3';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Logger } from 'pino';

const SCHEMA_SQL = [
  `CREATE TABLE IF NOT EXISTS tenders (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    sicap_id         TEXT UNIQUE NOT NULL,
    tier             TEXT NOT NULL,
    title            TEXT NOT NULL,
    authority_name   TEXT,
    authority_cui    TEXT,
    county           TEXT NOT NULL DEFAULT '',
    cpv_code         TEXT,
    cpv_label        TEXT,
    value_ron        REAL,
    publication_date TEXT NOT NULL,
    state            TEXT NOT NULL,
    url              TEXT NOT NULL,
    deadline         TEXT,
    type             TEXT,
    first_seen_at    TEXT NOT NULL DEFAULT (datetime('now')),
    last_updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
    alerted          INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS run_log (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    run_at          TEXT NOT NULL DEFAULT (datetime('now')),
    cron_slot       TEXT NOT NULL,
    total_fetched   INTEGER NOT NULL DEFAULT 0,
    new_tenders     INTEGER NOT NULL DEFAULT 0,
    alerted_count   INTEGER NOT NULL DEFAULT 0,
    status          TEXT NOT NULL DEFAULT 'completed',
    error_message   TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_tenders_sicap_id ON tenders(sicap_id)`,
  `CREATE INDEX IF NOT EXISTS idx_tenders_alerted ON tenders(alerted)`,
  `CREATE INDEX IF NOT EXISTS idx_tenders_county ON tenders(county)`,
  `CREATE INDEX IF NOT EXISTS idx_tenders_publication ON tenders(publication_date)`,
  `CREATE INDEX IF NOT EXISTS idx_run_log_run_at ON run_log(run_at)`,
];

/** Initialise the SQLite database — creates directory, opens DB, runs schema. */
export function initDatabase(dbPath: string, logger: Logger): DbType {
  // Ensure the parent directory exists
  const dir = dirname(dbPath);
  if (dir && !existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    logger.info(`Created directory: ${dir}`);
  }

  const db = new Database(dbPath, { verbose: (msg?: unknown) => logger.debug(String(msg ?? '')) });

  // WAL mode for better concurrent read performance
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Run schema
  for (const sql of SCHEMA_SQL) {
    db.exec(sql);
  }

  logger.info(`Database initialised: ${dbPath}`);
  return db;
}

/** Close the database connection. */
export function closeDatabase(db: DbType): void {
  db.close();
}

/** Verify the database schema is intact (useful for health checks). */
export function verifySchema(db: DbType): boolean {
  const tables = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('tenders', 'run_log')",
    )
    .all() as Array<{ name: string }>;

  return tables.length === 2;
}
