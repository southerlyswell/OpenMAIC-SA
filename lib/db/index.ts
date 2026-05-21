import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { createLogger } from '@/lib/logger';

const log = createLogger('SQLiteDB');

const DB_PATH = path.join(process.cwd(), 'data', 'maic.db');

// Row type interfaces
interface PhaseRow { id: string; name: string; grades: string }
interface SubjectRow { id: string; phase_id: string; name: string; grade: number; caps_document_url: string | null }
interface TopicRow { id: string; subject_id: string; title: string; caps_code: string | null; sequence: number; learning_outcomes: string | null }
interface LessonRow { id: string; topic_id: string | null; title: string; grade: number; subject: string; language: string; scene_types: string | null; duration_min: number | null; classroom_json_path: string | null; created_at: string; updated_at: string; version: number; status: string }
interface MediaRow { id: string; lesson_id: string; type: string; filename: string; path: string; size_bytes: number | null; duration_sec: number | null; format: string | null }

let _db: Database.Database | null = null;

export function getDB(): Database.Database {
  if (!_db) {
    throw new Error('Database not initialized. Call initSQLiteDB() first.');
  }
  return _db;
}

export function initSQLiteDB(): Database.Database {
  if (_db) return _db;

  const dataDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  log.info(`Opening SQLite database at ${DB_PATH}`);
  _db = new Database(DB_PATH);

  // WAL mode for better concurrent read performance
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');

  createSchema(_db);
  log.info('SQLite schema ready');

  return _db;
}

function createSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS phases (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      grades TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS subjects (
      id TEXT PRIMARY KEY,
      phase_id TEXT REFERENCES phases(id),
      name TEXT NOT NULL,
      grade INTEGER NOT NULL,
      caps_document_url TEXT
    );

    CREATE TABLE IF NOT EXISTS topics (
      id TEXT PRIMARY KEY,
      subject_id TEXT REFERENCES subjects(id),
      title TEXT NOT NULL,
      caps_code TEXT,
      sequence INTEGER,
      learning_outcomes TEXT
    );

    CREATE TABLE IF NOT EXISTS lessons (
      id TEXT PRIMARY KEY,
      topic_id TEXT REFERENCES topics(id),
      title TEXT NOT NULL,
      grade INTEGER NOT NULL,
      subject TEXT NOT NULL,
      language TEXT DEFAULT 'en',
      scene_types TEXT,
      duration_min INTEGER,
      classroom_json_path TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      version INTEGER DEFAULT 1,
      status TEXT DEFAULT 'published'
    );

    CREATE TABLE IF NOT EXISTS media (
      id TEXT PRIMARY KEY,
      lesson_id TEXT REFERENCES lessons(id),
      type TEXT NOT NULL,
      filename TEXT NOT NULL,
      path TEXT NOT NULL,
      size_bytes INTEGER,
      duration_sec INTEGER,
      format TEXT
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT DEFAULT 'student',
      grade INTEGER,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS progress (
      user_id TEXT REFERENCES users(id),
      lesson_id TEXT REFERENCES lessons(id),
      status TEXT DEFAULT 'not_started',
      score REAL,
      time_spent_sec INTEGER,
      last_position TEXT,
      completed_at TEXT,
      UNIQUE(user_id, lesson_id)
    );

    CREATE INDEX IF NOT EXISTS idx_subjects_phase ON subjects(phase_id);
    CREATE INDEX IF NOT EXISTS idx_topics_subject ON topics(subject_id);
    CREATE INDEX IF NOT EXISTS idx_lessons_grade ON lessons(grade);
    CREATE INDEX IF NOT EXISTS idx_lessons_subject ON lessons(subject);
    CREATE INDEX IF NOT EXISTS idx_lessons_topic ON lessons(topic_id);
    CREATE INDEX IF NOT EXISTS idx_lessons_status ON lessons(status);
    CREATE INDEX IF NOT EXISTS idx_media_lesson ON media(lesson_id);
    CREATE INDEX IF NOT EXISTS idx_progress_user ON progress(user_id);
    CREATE INDEX IF NOT EXISTS idx_progress_lesson ON progress(lesson_id);
  `);
}

// ========== Query Functions ==========

export function getAllLessons(): LessonRow[] {
  const db = getDB();
  return db.prepare('SELECT * FROM lessons ORDER BY grade, subject, created_at DESC').all() as LessonRow[];
}

export function getLessonById(id: string): LessonRow | undefined {
  const db = getDB();
  return db.prepare('SELECT * FROM lessons WHERE id = ?').get(id) as LessonRow | undefined;
}

export function getLessonsByGrade(grade: number): LessonRow[] {
  const db = getDB();
  return db.prepare('SELECT * FROM lessons WHERE grade = ? ORDER BY subject, created_at DESC').all(grade) as LessonRow[];
}

export function getLessonsBySubject(subject: string): LessonRow[] {
  const db = getDB();
  return db.prepare('SELECT * FROM lessons WHERE subject = ? ORDER BY grade, created_at DESC').all(subject) as LessonRow[];
}

export function getLessonsByTopic(topicId: string): LessonRow[] {
  const db = getDB();
  return db.prepare('SELECT * FROM lessons WHERE topic_id = ? ORDER BY created_at DESC').all(topicId) as LessonRow[];
}

export function getPhases(): PhaseRow[] {
  const db = getDB();
  return db.prepare('SELECT * FROM phases ORDER BY id').all() as PhaseRow[];
}

export function getSubjectsByPhase(phaseId: string): SubjectRow[] {
  const db = getDB();
  return db.prepare('SELECT * FROM subjects WHERE phase_id = ? ORDER BY grade, name').all(phaseId) as SubjectRow[];
}

export function getTopicsBySubject(subjectId: string): TopicRow[] {
  const db = getDB();
  return db.prepare('SELECT * FROM topics WHERE subject_id = ? ORDER BY sequence').all(subjectId) as TopicRow[];
}

/**
 * Count filesystem classroom dirs not yet in the DB.
 */
export function countUnimportedClassrooms(): number {
  const db = getDB();
  const classroomsDir = path.join(process.cwd(), 'data', 'classrooms');
  if (!fs.existsSync(classroomsDir)) return 0;

  const dirs = fs.readdirSync(classroomsDir).filter((f) => {
    const fullPath = path.join(classroomsDir, f);
    return fs.statSync(fullPath).isDirectory() && !f.startsWith('.');
  });

  const existing = new Set(
    (db.prepare('SELECT id FROM lessons').all() as { id: string }[]).map((r) => r.id),
  );

  return dirs.filter((id) => !existing.has(id)).length;
}

export default initSQLiteDB;
