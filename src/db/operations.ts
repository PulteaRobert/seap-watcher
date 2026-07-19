/**
 * Database CRUD operations for tenders and run logs.
 *
 * Uses prepared statements from better-sqlite3 for type-safe, efficient queries.
 */

import type { Database } from 'better-sqlite3';
import type { SeapTender, RunLog } from '../seap/types.js';

/* ------------------------------------------------------------------ */
/*  Tender operations                                                  */
/* ------------------------------------------------------------------ */

/** Insert or update a tender by sicap_id (upsert). */
export function upsertTender(db: Database, tender: SeapTender): void {
  const stmt = db.prepare(`
    INSERT INTO tenders (
      sicap_id, tier, title, authority_name, authority_cui,
      county, cpv_code, cpv_label, value_ron, publication_date,
      state, url, deadline, type, alerted, near_threshold
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
    ON CONFLICT(sicap_id) DO UPDATE SET
      tier             = excluded.tier,
      title            = excluded.title,
      authority_name   = excluded.authority_name,
      authority_cui    = excluded.authority_cui,
      county           = excluded.county,
      cpv_code         = excluded.cpv_code,
      cpv_label        = excluded.cpv_label,
      value_ron        = excluded.value_ron,
      publication_date = excluded.publication_date,
      state            = excluded.state,
      url              = excluded.url,
      deadline         = excluded.deadline,
      type             = excluded.type,
      near_threshold   = excluded.near_threshold,
      last_updated_at  = datetime('now')
  `);

  stmt.run(
    tender.sicapId,
    tender.tier,
    tender.title,
    tender.authorityName,
    tender.authorityCui ?? null,
    tender.county,
    tender.cpvCode,
    tender.cpvLabel ?? null,
    tender.valueRon ?? null,
    tender.publicationDate,
    tender.state,
    tender.url,
    tender.deadline ?? null,
    tender.type,
    tender.nearThreshold ? 1 : 0,
  );
}

/** Upsert multiple tenders in a transaction for efficiency. */
export function upsertTenders(db: Database, tenders: SeapTender[]): void {
  const tx = db.transaction((tenders: SeapTender[]) => {
    for (const tender of tenders) {
      upsertTender(db, tender);
    }
  });

  tx(tenders);
}

/** Check if a tender with the given sicap_id already exists. */
export function hasTender(db: Database, sicapId: string): boolean {
  const stmt = db.prepare(
    'SELECT COUNT(*) as count FROM tenders WHERE sicap_id = ?',
  );
  const result = stmt.get(sicapId) as { count: number };
  return result.count > 0;
}

/** Convert the raw 0/1 near_threshold column into a real boolean. */
function withNearThresholdBoolean(
  row: SeapTender & { nearThreshold: unknown },
): SeapTender {
  return { ...row, nearThreshold: !!row.nearThreshold };
}

/** Get all tenders that have not yet been alerted. */
export function getNewTenders(db: Database): SeapTender[] {
  const stmt = db.prepare(`
    SELECT sicap_id as sicapId, tier, title, authority_name as authorityName,
           authority_cui as authorityCui, county, cpv_code as cpvCode,
           cpv_label as cpvLabel, value_ron as valueRon,
           publication_date as publicationDate, state, url, deadline, type,
           near_threshold as nearThreshold
    FROM tenders
    WHERE alerted = 0
    ORDER BY publication_date DESC
  `);

  return (stmt.all() as (SeapTender & { nearThreshold: unknown })[]).map(
    withNearThresholdBoolean,
  );
}

/** Get new tenders since a specific date. */
export function getNewTendersSince(db: Database, sinceDate: string): SeapTender[] {
  const stmt = db.prepare(`
    SELECT sicap_id as sicapId, tier, title, authority_name as authorityName,
           authority_cui as authorityCui, county, cpv_code as cpvCode,
           cpv_label as cpvLabel, value_ron as valueRon,
           publication_date as publicationDate, state, url, deadline, type,
           near_threshold as nearThreshold
    FROM tenders
    WHERE alerted = 0 AND publication_date >= ?
    ORDER BY publication_date DESC
  `);

  return (stmt.all(sinceDate) as (SeapTender & { nearThreshold: unknown })[]).map(
    withNearThresholdBoolean,
  );
}

/** Mark tenders as alerted (set alerted = 1). */
export function markAsAlerted(db: Database, sicapIds: string[]): void {
  if (sicapIds.length === 0) return;

  const placeholders = sicapIds.map(() => '?').join(', ');
  const stmt = db.prepare(
    `UPDATE tenders SET alerted = 1 WHERE sicap_id IN (${placeholders})`,
  );
  stmt.run(...sicapIds);
}

/** Get the total number of tenders in the database. */
export function getTenderCount(db: Database): number {
  const result = db.prepare('SELECT COUNT(*) as count FROM tenders').get() as {
    count: number;
  };
  return result.count;
}

/** Get the number of alerted tenders. */
export function getAlertedCount(db: Database): number {
  const result = db.prepare(
    'SELECT COUNT(*) as count FROM tenders WHERE alerted = 1',
  ).get() as { count: number };
  return result.count;
}

/* ------------------------------------------------------------------ */
/*  Run log operations                                                 */
/* ------------------------------------------------------------------ */

/** Log a scheduled run. */
export function logRun(db: Database, run: RunLog): void {
  const stmt = db.prepare(`
    INSERT INTO run_log (run_at, cron_slot, total_fetched, new_tenders, alerted_count, status, error_message)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    run.runAt,
    run.cronSlot,
    run.totalFetched,
    run.newTenders,
    run.alertedCount,
    run.status,
    run.errorMessage ?? null,
  );
}

/** Get the last run log entry. */
export function getLastRun(db: Database): RunLog | null {
  const stmt = db.prepare(`
    SELECT run_at as runAt, cron_slot as cronSlot, total_fetched as totalFetched,
           new_tenders as newTenders, alerted_count as alertedCount,
           status, error_message as errorMessage
    FROM run_log
    ORDER BY id DESC
    LIMIT 1
  `);

  return (stmt.get() as RunLog) ?? null;
}

/** Get all run logs within a date range. */
export function getRunLogs(db: Database, since?: string): RunLog[] {
  if (since) {
    const stmt = db.prepare(`
      SELECT run_at as runAt, cron_slot as cronSlot, total_fetched as totalFetched,
             new_tenders as newTenders, alerted_count as alertedCount,
             status, error_message as errorMessage
      FROM run_log
      WHERE run_at >= ?
      ORDER BY run_at DESC
    `);
    return stmt.all(since) as RunLog[];
  }

  const stmt = db.prepare(`
    SELECT run_at as runAt, cron_slot as cronSlot, total_fetched as totalFetched,
           new_tenders as newTenders, alerted_count as alertedCount,
           status, error_message as errorMessage
    FROM run_log
    ORDER BY run_at DESC
  `);

  return stmt.all() as RunLog[];
}
