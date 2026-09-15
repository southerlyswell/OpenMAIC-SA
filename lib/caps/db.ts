import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';

/**
 * CAPS map database.
 *
 * PostgreSQL via the embedded engine (PGlite), chosen on 2026-09-14 so no
 * separate database service has to run locally. The SQL is standard PostgreSQL
 * and the access layer takes a generic query interface, so moving to a full
 * PostgreSQL server later is a connection change, not a rewrite.
 *
 * See dev-library/requirements-storage-foundation.md.
 */

const DATA_DIR = path.join(process.cwd(), 'data', 'pglite');

const CAPS_SCHEMA = `
CREATE TABLE IF NOT EXISTS caps_subjects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  grades INTEGER[] NOT NULL DEFAULT '{}',
  caps_document_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS caps_topics (
  id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL REFERENCES caps_subjects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  caps_code TEXT,
  grade INTEGER,
  sequence INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS caps_topics_subject_idx ON caps_topics (subject_id);

CREATE TABLE IF NOT EXISTS caps_lessons (
  id TEXT PRIMARY KEY,
  topic_id TEXT NOT NULL REFERENCES caps_topics(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS caps_lessons_topic_idx ON caps_lessons (topic_id);
`;

/**
 * The narrow query surface the access layer needs. A full PostgreSQL server's
 * pool satisfies this too, which is what keeps the move to a server small.
 */
export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

// A module-level promise: concurrent callers all await the same initialisation,
// so PGlite is never opened twice against the same directory.
let databasePromise: Promise<PGlite> | null = null;

/**
 * Bring an existing database forward. CREATE TABLE IF NOT EXISTS does nothing to
 * a table that already exists, so a column added after the first run needs its
 * own statement. Safe to run repeatedly.
 *
 * Existing topics get NO grade rather than a guessed one: a topic without a grade
 * is shown as "no grade set" so the gap is visible, never quietly filed under an
 * assumed grade. (Decided 2026-09-14.)
 */
async function migrate(db: PGlite): Promise<void> {
  // Add the column first, then anything that depends on it. Doing this the other
  // way round fails on a database created before the column existed, because the
  // schema above cannot create an index on a column that is not there yet.
  await db.query('ALTER TABLE caps_topics ADD COLUMN IF NOT EXISTS grade INTEGER');
  await db.query(
    'CREATE INDEX IF NOT EXISTS caps_topics_grade_idx ON caps_topics (subject_id, grade)',
  );
}

async function openDatabase(): Promise<PGlite> {
  const db = await PGlite.create(DATA_DIR);
  for (const statement of CAPS_SCHEMA.split(';')) {
    const trimmed = statement.trim();
    if (trimmed) await db.query(trimmed);
  }
  await migrate(db);
  return db;
}

export function getDatabase(): Promise<PGlite> {
  if (!databasePromise) {
    databasePromise = openDatabase();
  }
  return databasePromise;
}

export async function getQueryable(): Promise<Queryable> {
  return getDatabase();
}
