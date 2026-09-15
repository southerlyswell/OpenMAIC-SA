/**
 * Proves the learner-data retention rule before it is relied on.
 *
 * Run: node_modules/.bin/tsx scripts/test-retention.ts
 *
 * Three things are proven:
 *   1. A session untouched for more than 12 months is deleted, with its records.
 *   2. A session inside the window is kept.
 *   3. Deleting one learner leaves every other learner untouched.
 *
 * The test uses its own learner keys (RETENTION-TEST-*) and removes them at the
 * end, so it cannot disturb real data.
 */
import { getQueryable } from '../lib/caps/db';
import {
  deleteLearnerRuntime,
  ensureRuntimeSchema,
  pruneInactiveSessions,
  retentionCutoff,
  retentionSummary,
} from '../lib/caps/retention';

const STALE_LEARNER = 'RETENTION-TEST-STALE';
const RECENT_LEARNER = 'RETENTION-TEST-RECENT';
const OTHER_LEARNER = 'RETENTION-TEST-OTHER';

function iso(d: Date) {
  return d.toISOString();
}

function monthsAgo(months: number, extraDays = 0) {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  d.setDate(d.getDate() - extraDays);
  return d;
}

let failures = 0;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}`);
  if (!condition) failures += 1;
}

async function cleanup() {
  const db = await getQueryable();
  await ensureRuntimeSchema();
  await db.query('DELETE FROM runtime_sessions WHERE learner_key LIKE $1', ['RETENTION-TEST-%']);
}

async function insertSession(id: string, learnerKey: string, updatedAt: Date) {
  const db = await getQueryable();
  await db.query(
    `INSERT INTO runtime_sessions (id, stage_id, learner_key, kind, status, created_at, updated_at, data)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [id, 'stage-retention-test', learnerKey, 'course', 'active', iso(updatedAt), iso(updatedAt), '{}'],
  );
}

async function insertRecord(id: string, sessionId: string, seq: number) {
  const db = await getQueryable();
  await db.query(
    `INSERT INTO runtime_records (id, session_id, seq, scene_id, created_at, data)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, sessionId, seq, 'scene-1', iso(new Date()), '{}'],
  );
}

async function main() {
  await ensureRuntimeSchema();
  await cleanup();

  console.log('--- the cut-off itself ---');
  const cutoff = retentionCutoff(new Date('2026-09-15T00:00:00Z'));
  console.log('  15 Sep 2026 minus 12 months =', cutoff.toISOString());
  check('cut-off is exactly 12 calendar months back', cutoff.toISOString().startsWith('2025-09-15'));

  console.log('\n--- set up ---');
  // 13 months old: past the window, must go.
  await insertSession('rt-stale', STALE_LEARNER, monthsAgo(13));
  await insertRecord('rt-stale-r1', 'rt-stale', 0);
  await insertRecord('rt-stale-r2', 'rt-stale', 1);
  // 11 months old: inside the window, must stay.
  await insertSession('rt-recent', RECENT_LEARNER, monthsAgo(11));
  await insertRecord('rt-recent-r1', 'rt-recent', 0);
  // Another learner, also old, to prove deletion is targeted.
  await insertSession('rt-other', OTHER_LEARNER, monthsAgo(13));
  await insertRecord('rt-other-r1', 'rt-other', 0);
  console.log('  3 sessions, 4 records created (two of them 13 months old)');

  const before = await retentionSummary();
  console.log('  due for deletion before the sweep:', before.sessionsDueForDeletion);
  check('the sweep sees 2 stale sessions (both 13 months old)', before.sessionsDueForDeletion === 2);

  console.log('\n--- run the 12-month sweep ---');
  const swept = await pruneInactiveSessions();
  console.log('  deleted sessions:', swept.sessionsDeleted, '| records:', swept.recordsDeleted);
  check('both stale sessions removed', swept.sessionsDeleted === 2);
  check('their 3 records removed with them', swept.recordsDeleted === 3);

  const db = await getQueryable();
  const survivors = await db.query<{ learner_key: string }>(
    `SELECT learner_key FROM runtime_sessions WHERE learner_key LIKE $1`,
    ['RETENTION-TEST-%'],
  );
  check('the recent learner was kept', survivors.rows.some((r) => r.learner_key === RECENT_LEARNER));
  check(
    'the stale learner is gone',
    !survivors.rows.some((r) => r.learner_key === STALE_LEARNER),
  );

  console.log('\n--- a deletion request for one learner ---');
  // Re-create an old session for the target learner.
  await insertSession('rt-target', OTHER_LEARNER, monthsAgo(1));
  await insertRecord('rt-target-r1', 'rt-target', 0);
  // A second learner with a current session that must survive.
  await insertSession('rt-bystander', 'RETENTION-TEST-BYSTANDER', monthsAgo(1));
  await insertRecord('rt-bystander-r1', 'rt-bystander', 0);

  const deletion = await deleteLearnerRuntime(OTHER_LEARNER);
  console.log('  deleted for that learner:', deletion.sessionsDeleted, 'sessions');
  check('the requesting learner had their session deleted', deletion.sessionsDeleted >= 1);

  const after = await db.query<{ learner_key: string }>(
    `SELECT learner_key FROM runtime_sessions WHERE learner_key LIKE $1`,
    ['RETENTION-TEST-%'],
  );
  check(
    'the other learner was NOT touched',
    after.rows.some((r) => r.learner_key === 'RETENTION-TEST-BYSTANDER'),
  );
  check(
    'the requesting learner has nothing left',
    !after.rows.some((r) => r.learner_key === OTHER_LEARNER),
  );

  console.log('\n--- clean up test data ---');
  await cleanup();
  const remaining = await db.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM runtime_sessions WHERE learner_key LIKE $1`,
    ['RETENTION-TEST-%'],
  );
  check('no test data left behind', Number(remaining.rows[0]?.n ?? 0) === 0);

  console.log(failures === 0 ? '\nALL RETENTION CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
