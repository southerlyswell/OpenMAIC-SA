import { getQueryable } from '@/lib/caps/db';

/**
 * Learner-data retention — the rule Patrick decided on 2026-09-14.
 *
 *   "Minimal data. Auto-delete after 12 months of inactivity. A learner or parent
 *    can request deletion at any time and it is honoured."
 *
 * Written against the product's OWN learner-record tables (runtime_sessions /
 * runtime_records) rather than a second store, as Patrick chose. The table
 * definitions match packages/@openmaic/storage/src/runtime/pg.ts exactly, so
 * when the product's own runtime store starts using this database it will find
 * the tables it expects.
 *
 * "Activity" is the session's updated_at, the last time anything was written to
 * it. A learner with no session touched for 12 months has nothing left worth
 * keeping: the records belong to sessions.
 *
 * See dev-library/requirements-storage-foundation.md.
 */

const RUNTIME_SCHEMA = `
CREATE TABLE IF NOT EXISTS runtime_sessions (
  id TEXT PRIMARY KEY,
  stage_id TEXT NOT NULL,
  learner_key TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  data JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS runtime_sessions_stage_learner_idx
  ON runtime_sessions (stage_id, learner_key);
CREATE INDEX IF NOT EXISTS runtime_sessions_learner_idx
  ON runtime_sessions (learner_key);

CREATE TABLE IF NOT EXISTS runtime_records (
  id TEXT NOT NULL,
  session_id TEXT NOT NULL REFERENCES runtime_sessions(id) ON DELETE CASCADE,
  seq BIGINT NOT NULL CHECK (seq >= 0),
  scene_id TEXT,
  created_at TEXT NOT NULL,
  data JSONB NOT NULL,
  CONSTRAINT runtime_records_session_seq_unique UNIQUE (session_id, seq)
);

CREATE INDEX IF NOT EXISTS runtime_records_session_scene_idx
  ON runtime_records (session_id, scene_id);
`;

export const RETENTION_MONTHS = 12;

/** Create the learner-record tables when absent. Safe to call repeatedly. */
export async function ensureRuntimeSchema(): Promise<void> {
  const db = await getQueryable();
  for (const statement of RUNTIME_SCHEMA.split(';')) {
    const trimmed = statement.trim();
    if (trimmed) await db.query(trimmed);
  }
}

/**
 * The cut-off date. Records last touched before this are deleted.
 *
 * A calendar month is not a fixed number of days, so this subtracts whole months
 * via Date semantics rather than a day count — 15 March minus 12 months is
 * 15 March, not "375 days ago".
 */
export function retentionCutoff(now: Date = new Date(), months: number = RETENTION_MONTHS): Date {
  const cutoff = new Date(now.getTime());
  cutoff.setMonth(cutoff.getMonth() - months);
  return cutoff;
}

export interface PruneResult {
  cutoff: string;
  sessionsDeleted: number;
  recordsDeleted: number;
}

/**
 * Delete every learner session not touched within the retention window, and the
 * records belonging to those sessions (through ON DELETE CASCADE).
 *
 * Returns what it removed so the caller can record or report the deletion. It is
 * deliberately not silent: a rule that deletes learner data without leaving a
 * count behind is not auditable.
 */
export async function pruneInactiveSessions(
  now: Date = new Date(),
  months: number = RETENTION_MONTHS,
): Promise<PruneResult> {
  const db = await getQueryable();
  await ensureRuntimeSchema();

  const cutoff = retentionCutoff(now, months).toISOString();

  const doomed = await db.query<{ id: string }>(
    'SELECT id FROM runtime_sessions WHERE updated_at < $1',
    [cutoff],
  );
  const ids = doomed.rows.map((row) => row.id);

  let recordsDeleted = 0;
  if (ids.length > 0) {
    const recordCount = await db.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM runtime_records WHERE session_id = ANY($1::text[])`,
      [ids],
    );
    recordsDeleted = Number(recordCount.rows[0]?.n ?? 0);
    await db.query('DELETE FROM runtime_sessions WHERE id = ANY($1::text[])', [ids]);
  }

  return { cutoff, sessionsDeleted: ids.length, recordsDeleted };
}

export interface LearnerDeletionResult {
  learnerKey: string;
  sessionsDeleted: number;
  recordsDeleted: number;
}

/**
 * Delete everything held for one learner. This is the "a learner or parent can
 * ask for deletion at any time" path: it removes that learner's sessions and
 * their records, and touches no other learner.
 */
export async function deleteLearnerRuntime(learnerKey: string): Promise<LearnerDeletionResult> {
  const db = await getQueryable();
  await ensureRuntimeSchema();

  const doomed = await db.query<{ id: string }>(
    'SELECT id FROM runtime_sessions WHERE learner_key = $1',
    [learnerKey],
  );
  const ids = doomed.rows.map((row) => row.id);

  let recordsDeleted = 0;
  if (ids.length > 0) {
    const recordCount = await db.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM runtime_records WHERE session_id = ANY($1::text[])`,
      [ids],
    );
    recordsDeleted = Number(recordCount.rows[0]?.n ?? 0);
    await db.query('DELETE FROM runtime_sessions WHERE id = ANY($1::text[])', [ids]);
  }

  return { learnerKey, sessionsDeleted: ids.length, recordsDeleted };
}

/** What is currently held, for reporting and for proving a deletion worked. */
export async function retentionSummary(now: Date = new Date()) {
  const db = await getQueryable();
  await ensureRuntimeSchema();

  const cutoff = retentionCutoff(now).toISOString();
  const result = await db.query<{
    sessions: number;
    records: number;
    learners: number;
    stale_sessions: number;
    oldest_activity: string | null;
  }>(
    `SELECT
       (SELECT COUNT(*)::int FROM runtime_sessions) AS sessions,
       (SELECT COUNT(*)::int FROM runtime_records) AS records,
       (SELECT COUNT(DISTINCT learner_key)::int FROM runtime_sessions) AS learners,
       (SELECT COUNT(*)::int FROM runtime_sessions WHERE updated_at < $1) AS stale_sessions,
       (SELECT MIN(updated_at) FROM runtime_sessions) AS oldest_activity`,
    [cutoff],
  );

  const row = result.rows[0];
  return {
    cutoff,
    months: RETENTION_MONTHS,
    sessions: Number(row?.sessions ?? 0),
    records: Number(row?.records ?? 0),
    learners: Number(row?.learners ?? 0),
    sessionsDueForDeletion: Number(row?.stale_sessions ?? 0),
    oldestActivity: row?.oldest_activity ?? null,
  };
}
