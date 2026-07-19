/**
 * Tests for database CRUD operations.
 *
 * Uses an in-memory SQLite database for isolation.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  initDatabase,
  closeDatabase,
  verifySchema,
} from './database.js';
import {
  upsertTender,
  upsertTenders,
  hasTender,
  getNewTenders,
  getNewTendersSince,
  markAsAlerted,
  getTenderCount,
  getAlertedCount,
  logRun,
  getLastRun,
  getRunLogs,
} from './operations.js';
import type { SeapTender } from '../seap/types.js';

const logger = {
  info: () => {},
  debug: () => {},
  warn: () => {},
  error: () => {},
} as any;

function createInMemoryDb() {
  // Use :memory: for isolated tests
  const db = new Database(':memory:');

  // Run schema manually (initDatabase expects a file path)
  const SCHEMA_SQL = [
    `CREATE TABLE IF NOT EXISTS tenders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sicap_id TEXT UNIQUE NOT NULL,
      tier TEXT NOT NULL,
      title TEXT NOT NULL,
      authority_name TEXT,
      authority_cui TEXT,
      county TEXT NOT NULL DEFAULT '',
      cpv_code TEXT,
      cpv_label TEXT,
      value_ron REAL,
      publication_date TEXT NOT NULL,
      state TEXT NOT NULL,
      url TEXT NOT NULL,
      deadline TEXT,
      type TEXT,
      first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      alerted INTEGER NOT NULL DEFAULT 0
    )`,
    `CREATE TABLE IF NOT EXISTS run_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_at TEXT NOT NULL DEFAULT (datetime('now')),
      cron_slot TEXT NOT NULL,
      total_fetched INTEGER NOT NULL DEFAULT 0,
      new_tenders INTEGER NOT NULL DEFAULT 0,
      alerted_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'completed',
      error_message TEXT
    )`,
    `CREATE INDEX IF NOT EXISTS idx_tenders_sicap_id ON tenders(sicap_id)`,
    `CREATE INDEX IF NOT EXISTS idx_tenders_alerted ON tenders(alerted)`,
    `CREATE INDEX IF NOT EXISTS idx_tenders_county ON tenders(county)`,
    `CREATE INDEX IF NOT EXISTS idx_tenders_publication ON tenders(publication_date)`,
    `CREATE INDEX IF NOT EXISTS idx_run_log_run_at ON run_log(run_at)`,
  ];

  for (const sql of SCHEMA_SQL) {
    db.exec(sql);
  }

  return db;
}

const FIXTURE_TENDER: SeapTender = {
  sicapId: 'SCN1175406',
  tier: 'above_threshold',
  title: 'Servicii informatice',
  authorityName: 'Directia Fiscala Brasov',
  authorityCui: '21666630',
  county: 'Brasov',
  cpvCode: '72910000-2',
  cpvLabel: 'Servicii de siguranta informatica (Rev.2)',
  valueRon: 220254.3,
  publicationDate: '2026-05-19T08:14:27+03:00',
  state: 'Publicat',
  url: 'https://e-licitatie.ro/pub/notices/c-notice/v2/view/100239953',
  deadline: '2026-05-29T15:00:00+03:00',
  type: 'Servicii',
};

describe('Database operations', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createInMemoryDb();
  });

  describe('upsertTender', () => {
    it('inserts a new tender', () => {
      upsertTender(db, FIXTURE_TENDER);

      expect(hasTender(db, 'SCN1175406')).toBe(true);
      expect(getTenderCount(db)).toBe(1);
    });

    it('updates an existing tender (upsert)', () => {
      upsertTender(db, FIXTURE_TENDER);

      const updatedTender: SeapTender = {
        ...FIXTURE_TENDER,
        title: 'Updated title',
        valueRon: 300000,
      };
      upsertTender(db, updatedTender);

      // Still 1 tender, not 2
      expect(getTenderCount(db)).toBe(1);

      // Verify the update took effect
      const stmt = db.prepare(
        'SELECT title, value_ron FROM tenders WHERE sicap_id = ?',
      );
      const row = stmt.get('SCN1175406') as {
        title: string;
        value_ron: number;
      };
      expect(row.title).toBe('Updated title');
      expect(row.value_ron).toBe(300000);
    });

    it('sets alerted=0 for new tenders', () => {
      upsertTender(db, FIXTURE_TENDER);

      const stmt = db.prepare(
        'SELECT alerted FROM tenders WHERE sicap_id = ?',
      );
      const row = stmt.get('SCN1175406') as { alerted: number };
      expect(row.alerted).toBe(0);
    });
  });

  describe('upsertTenders', () => {
    it('inserts multiple tenders in a transaction', () => {
      const tenders: SeapTender[] = [
        FIXTURE_TENDER,
        { ...FIXTURE_TENDER, sicapId: 'CN1090827', title: 'Second tender' },
        { ...FIXTURE_TENDER, sicapId: 'CN1090700', title: 'Third tender' },
      ];

      upsertTenders(db, tenders);

      expect(getTenderCount(db)).toBe(3);
      expect(hasTender(db, 'SCN1175406')).toBe(true);
      expect(hasTender(db, 'CN1090827')).toBe(true);
      expect(hasTender(db, 'CN1090700')).toBe(true);
    });
  });

  describe('hasTender', () => {
    it('returns false for unknown tenders', () => {
      expect(hasTender(db, 'UNKNOWN123')).toBe(false);
    });

    it('returns true for existing tenders', () => {
      upsertTender(db, FIXTURE_TENDER);
      expect(hasTender(db, 'SCN1175406')).toBe(true);
    });
  });

  describe('getNewTenders', () => {
    it('returns unalerted tenders', () => {
      upsertTender(db, FIXTURE_TENDER);
      upsertTender(db, {
        ...FIXTURE_TENDER,
        sicapId: 'CN1090827',
        title: 'Second tender',
      });

      const newTenders = getNewTenders(db);
      expect(newTenders).toHaveLength(2);
    });

    it('excludes alerted tenders', () => {
      upsertTender(db, FIXTURE_TENDER);
      markAsAlerted(db, ['SCN1175406']);

      const newTenders = getNewTenders(db);
      expect(newTenders).toHaveLength(0);
    });

    it('returns empty array when no tenders exist', () => {
      const newTenders = getNewTenders(db);
      expect(newTenders).toHaveLength(0);
    });
  });

  describe('getNewTendersSince', () => {
    it('filters by publication date', () => {
      upsertTender(db, FIXTURE_TENDER);
      upsertTender(db, {
        ...FIXTURE_TENDER,
        sicapId: 'OLD001',
        publicationDate: '2025-01-01T00:00:00+00:00',
      });

      const newTenders = getNewTendersSince(
        db,
        '2026-01-01T00:00:00Z',
      );
      expect(newTenders).toHaveLength(1);
      expect(newTenders[0].sicapId).toBe('SCN1175406');
    });
  });

  describe('markAsAlerted', () => {
    it('marks tenders as alerted', () => {
      upsertTender(db, FIXTURE_TENDER);
      markAsAlerted(db, ['SCN1175406']);

      const stmt = db.prepare(
        'SELECT alerted FROM tenders WHERE sicap_id = ?',
      );
      const row = stmt.get('SCN1175406') as { alerted: number };
      expect(row.alerted).toBe(1);
    });

    it('does nothing with empty list', () => {
      upsertTender(db, FIXTURE_TENDER);
      markAsAlerted(db, []);

      const stmt = db.prepare(
        'SELECT alerted FROM tenders WHERE sicap_id = ?',
      );
      const row = stmt.get('SCN1175406') as { alerted: number };
      expect(row.alerted).toBe(0);
    });

    it('marks multiple tenders', () => {
      upsertTender(db, FIXTURE_TENDER);
      upsertTender(db, {
        ...FIXTURE_TENDER,
        sicapId: 'CN1090827',
      });

      markAsAlerted(db, ['SCN1175406', 'CN1090827']);
      expect(getAlertedCount(db)).toBe(2);
    });
  });

  describe('getTenderCount / getAlertedCount', () => {
    it('returns correct counts', () => {
      upsertTender(db, FIXTURE_TENDER);
      upsertTender(db, { ...FIXTURE_TENDER, sicapId: 'CN1090827' });
      markAsAlerted(db, ['SCN1175406']);

      expect(getTenderCount(db)).toBe(2);
      expect(getAlertedCount(db)).toBe(1);
    });
  });

  describe('logRun / getLastRun / getRunLogs', () => {
    it('logs a run and retrieves it', () => {
      logRun(db, {
        runAt: '2026-05-20T09:00:00Z',
        cronSlot: 'morning',
        totalFetched: 10,
        newTenders: 3,
        alertedCount: 3,
        status: 'completed',
      });

      const lastRun = getLastRun(db);
      expect(lastRun).not.toBeNull();
      expect(lastRun?.cronSlot).toBe('morning');
      expect(lastRun?.totalFetched).toBe(10);
      expect(lastRun?.newTenders).toBe(3);
    });

    it('stores error messages', () => {
      logRun(db, {
        runAt: '2026-05-20T09:00:00Z',
        cronSlot: 'morning',
        totalFetched: 0,
        newTenders: 0,
        alertedCount: 0,
        status: 'failed',
        errorMessage: 'Network timeout',
      });

      const lastRun = getLastRun(db);
      expect(lastRun?.status).toBe('failed');
      expect(lastRun?.errorMessage).toBe('Network timeout');
    });

    it('returns multiple run logs', () => {
      logRun(db, {
        runAt: '2026-05-20T09:00:00Z',
        cronSlot: 'morning',
        totalFetched: 10,
        newTenders: 3,
        alertedCount: 3,
        status: 'completed',
      });

      logRun(db, {
        runAt: '2026-05-20T15:00:00Z',
        cronSlot: 'afternoon',
        totalFetched: 8,
        newTenders: 1,
        alertedCount: 1,
        status: 'completed',
      });

      const logs = getRunLogs(db);
      expect(logs).toHaveLength(2);
    });
  });

  describe('verifySchema', () => {
    it('returns true for a valid schema', () => {
      expect(verifySchema(db)).toBe(true);
    });
  });
});
