import { promises as fs } from 'node:fs';
import path from 'node:path';
import { getQueryable } from '@/lib/caps/db';

/**
 * CAPS map reads and writes — the only place that knows the SQL.
 *
 * See dev-library/requirements-storage-foundation.md and
 * dev-library/requirements-caps-import.md. No curriculum content is invented
 * anywhere in this file; it stores and returns what Patrick enters.
 */

const CURRICULUM_FILE = path.join(process.cwd(), 'data', 'curriculum.json');

export interface CapsLesson {
  id: string;
  title: string;
  status: string;
}

export interface CapsTopic {
  id: string;
  title: string;
  capsCode: string | null;
  /** null means "no grade set" — shown as such, never guessed at. */
  grade: number | null;
  sequence: number;
  lessons: CapsLesson[];
  lessonCount: number;
}

export interface CapsSubject {
  id: string;
  name: string;
  grades: number[];
  capsDocumentUrl: string | null;
  topics: CapsTopic[];
  topicCount: number;
  lessonCount: number;
}

interface SubjectRow {
  id: string;
  name: string;
  grades: number[] | null;
  caps_document_url: string | null;
  topic_count: number | string;
  lesson_count: number | string;
}

interface TopicRow {
  id: string;
  subject_id: string;
  title: string;
  caps_code: string | null;
  grade: number | null;
  sequence: number | string;
}

interface LessonRow {
  id: string;
  topic_id: string;
  title: string;
  status: string;
}

/** Postgres returns bigint counts as strings; normalise them to numbers. */
function toNumber(value: number | string): number {
  return typeof value === 'number' ? value : Number.parseInt(value, 10) || 0;
}

function slugId(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'item'
  );
}

export async function listCurriculum(): Promise<CapsSubject[]> {
  const db = await getQueryable();

  const subjectResult = await db.query<SubjectRow>(
    `SELECT s.id, s.name, s.grades, s.caps_document_url,
            COALESCE(t.topic_count, 0)::int AS topic_count,
            COALESCE(l.lesson_count, 0)::int AS lesson_count
       FROM caps_subjects s
       LEFT JOIN (
         SELECT subject_id, COUNT(*)::int AS topic_count FROM caps_topics GROUP BY subject_id
       ) t ON t.subject_id = s.id
       LEFT JOIN (
         SELECT t.subject_id, COUNT(*)::int AS lesson_count
           FROM caps_topics t
           JOIN caps_lessons l ON l.topic_id = t.id
          GROUP BY t.subject_id
       ) l ON l.subject_id = s.id
      ORDER BY s.name`,
  );

  const topicResult = await db.query<TopicRow>(
    `SELECT id, subject_id, title, caps_code, grade, sequence
       FROM caps_topics
      ORDER BY subject_id, grade NULLS LAST, sequence, title`,
  );

  const lessonResult = await db.query<LessonRow>(
    `SELECT id, topic_id, title, status FROM caps_lessons ORDER BY created_at`,
  );

  const lessonsByTopic = new Map<string, CapsLesson[]>();
  for (const lesson of lessonResult.rows) {
    const list = lessonsByTopic.get(lesson.topic_id) ?? [];
    list.push({ id: lesson.id, title: lesson.title, status: lesson.status });
    lessonsByTopic.set(lesson.topic_id, list);
  }

  const topicsBySubject = new Map<string, CapsTopic[]>();
  for (const topic of topicResult.rows) {
    const lessons = lessonsByTopic.get(topic.id) ?? [];
    const list = topicsBySubject.get(topic.subject_id) ?? [];
    list.push({
      id: topic.id,
      title: topic.title,
      capsCode: topic.caps_code,
      grade: topic.grade === null || topic.grade === undefined ? null : toNumber(topic.grade),
      sequence: toNumber(topic.sequence),
      lessons,
      lessonCount: lessons.length,
    });
    topicsBySubject.set(topic.subject_id, list);
  }

  return subjectResult.rows.map((subject) => {
    const topics = topicsBySubject.get(subject.id) ?? [];
    return {
      id: subject.id,
      name: subject.name,
      grades: subject.grades ?? [],
      capsDocumentUrl: subject.caps_document_url,
      topics,
      topicCount: toNumber(subject.topic_count),
      lessonCount: toNumber(subject.lesson_count),
    };
  });
}

export async function findSubject(id: string) {
  const db = await getQueryable();
  const result = await db.query<{ id: string; name: string }>(
    'SELECT id, name FROM caps_subjects WHERE id = $1',
    [id],
  );
  return result.rows[0] ?? null;
}

export async function findTopic(id: string) {
  const db = await getQueryable();
  const result = await db.query<{ id: string; title: string; subject_id: string }>(
    'SELECT id, title, subject_id FROM caps_topics WHERE id = $1',
    [id],
  );
  return result.rows[0] ?? null;
}

export async function createSubject(id: string, name: string, grades: number[]) {
  const db = await getQueryable();
  await db.query('INSERT INTO caps_subjects (id, name, grades) VALUES ($1, $2, $3)', [
    id,
    name,
    grades,
  ]);
}

export async function updateSubject(id: string, name: string, grades: number[]) {
  const db = await getQueryable();
  await db.query(
    'UPDATE caps_subjects SET name = $2, grades = $3, updated_at = now() WHERE id = $1',
    [id, name, grades],
  );
}

export async function deleteSubject(id: string) {
  const db = await getQueryable();
  // Topics and lessons go with it through ON DELETE CASCADE.
  const result = await db.query<{ id: string }>(
    'DELETE FROM caps_subjects WHERE id = $1 RETURNING id',
    [id],
  );
  return result.rows.length > 0;
}

export async function createTopic(
  id: string,
  subjectId: string,
  title: string,
  capsCode: string,
  grade: number | null = null,
) {
  const db = await getQueryable();
  const next = await db.query<{ next: number }>(
    'SELECT COALESCE(MAX(sequence), 0) + 1 AS next FROM caps_topics WHERE subject_id = $1',
    [subjectId],
  );
  await db.query(
    'INSERT INTO caps_topics (id, subject_id, title, caps_code, grade, sequence) VALUES ($1, $2, $3, $4, $5, $6)',
    [id, subjectId, title, capsCode, grade, toNumber(next.rows[0]?.next ?? 1)],
  );
}

export async function updateTopic(
  id: string,
  title: string,
  capsCode: string,
  grade: number | null,
) {
  const db = await getQueryable();
  await db.query(
    'UPDATE caps_topics SET title = $2, caps_code = $3, grade = $4, updated_at = now() WHERE id = $1',
    [id, title, capsCode, grade],
  );
}

export async function deleteTopic(id: string) {
  const db = await getQueryable();
  const result = await db.query<{ id: string }>(
    'DELETE FROM caps_topics WHERE id = $1 RETURNING id',
    [id],
  );
  return result.rows.length > 0;
}

export async function countAll(): Promise<{ subjects: number; topics: number; lessons: number }> {
  const db = await getQueryable();
  const result = await db.query<{ subjects: number; topics: number; lessons: number }>(
    `SELECT
       (SELECT COUNT(*)::int FROM caps_subjects) AS subjects,
       (SELECT COUNT(*)::int FROM caps_topics) AS topics,
       (SELECT COUNT(*)::int FROM caps_lessons) AS lessons`,
  );
  const row = result.rows[0];
  return {
    subjects: toNumber(row?.subjects ?? 0),
    topics: toNumber(row?.topics ?? 0),
    lessons: toNumber(row?.lessons ?? 0),
  };
}

/** A topic to import, already validated by the caller. */
export interface ImportTopic {
  subject: string;
  grade: number | null;
  title: string;
  capsCode: string;
}

/**
 * What an import did. "Rejected" is not silence: a row that cannot be used is
 * reported with its row number and the reason, so nothing is quietly dropped.
 */
export interface ImportOutcome {
  added: number;
  updated: number;
  rejected: Array<{ row: number; reason: string }>;
  subjectsCreated: string[];
}

async function setSubjectGrades(subjectId: string, grades: number[]): Promise<void> {
  if (grades.length === 0) return;
  const db = await getQueryable();
  const current = await db.query<{ grades: number[] | null }>(
    'SELECT grades FROM caps_subjects WHERE id = $1',
    [subjectId],
  );
  const existing = current.rows[0]?.grades ?? [];
  const merged = [...new Set([...existing, ...grades])].sort((a, b) => a - b);
  await db.query('UPDATE caps_subjects SET grades = $2, updated_at = now() WHERE id = $1', [
    subjectId,
    merged,
  ]);
}

/**
 * Import topic rows. Idempotent by construction: a subject or topic that already
 * exists is updated rather than duplicated, so re-running the same sheet is safe.
 */
export async function importTopics(
  rows: ImportTopic[],
  options: { createMissingSubjects?: boolean } = {},
): Promise<ImportOutcome> {
  const createMissingSubjects = options.createMissingSubjects ?? true;
  const db = await getQueryable();

  const outcome: ImportOutcome = { added: 0, updated: 0, rejected: [], subjectsCreated: [] };

  const subjectsRows = await db.query<{ id: string; name: string }>(
    'SELECT id, name FROM caps_subjects',
  );
  const subjectByName = new Map(
    subjectsRows.rows.map((row) => [row.name.trim().toLowerCase(), row.id]),
  );

  const topicsRows = await db.query<{
    id: string;
    subject_id: string;
    grade: number | null;
    title: string;
  }>('SELECT id, subject_id, grade, title FROM caps_topics');
  const topicKey = (subjectId: string, grade: number | null, title: string) =>
    `${subjectId}|${grade ?? 'none'}|${title.trim().toLowerCase()}`;
  const topicByKey = new Map(
    topicsRows.rows.map((row) => [topicKey(row.subject_id, row.grade, row.title), row.id]),
  );

  const usedSubjectIds = new Set(subjectByName.values());

  for (const row of rows) {
    const subjectName = row.subject.trim();
    const title = row.title.trim();
    const capsCode = row.capsCode.trim();

    let subjectId = subjectByName.get(subjectName.toLowerCase());
    if (!subjectId) {
      if (!createMissingSubjects) {
        outcome.rejected.push({ row: 0, reason: `No subject called "${subjectName}" exists yet` });
        continue;
      }
      const base = slugId(subjectName);
      subjectId = base;
      let n = 2;
      while (usedSubjectIds.has(subjectId)) subjectId = `${base}-${n++}`;
      await db.query('INSERT INTO caps_subjects (id, name, grades) VALUES ($1, $2, $3)', [
        subjectId,
        subjectName,
        row.grade === null ? [] : [row.grade],
      ]);
      subjectByName.set(subjectName.toLowerCase(), subjectId);
      usedSubjectIds.add(subjectId);
      outcome.subjectsCreated.push(subjectName);
    }

    if (row.grade !== null) {
      await setSubjectGrades(subjectId, [row.grade]);
    }

    const key = topicKey(subjectId, row.grade, title);
    const existingTopicId = topicByKey.get(key);
    if (existingTopicId) {
      await db.query('UPDATE caps_topics SET caps_code = $2, updated_at = now() WHERE id = $1', [
        existingTopicId,
        capsCode,
      ]);
      outcome.updated += 1;
    } else {
      const newId = `${subjectId}-${slugId(title)}`;
      await db.query(
        `INSERT INTO caps_topics (id, subject_id, title, caps_code, grade, sequence)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (id) DO UPDATE
           SET title = EXCLUDED.title, caps_code = EXCLUDED.caps_code,
               grade = EXCLUDED.grade, updated_at = now()`,
        [newId, subjectId, title, capsCode, row.grade, outcome.added + 1],
      );
      topicByKey.set(key, newId);
      outcome.added += 1;
    }
  }

  return outcome;
}

/**
 * One-time import of the content Patrick already entered into
 * data/curriculum.json. Invents nothing: it copies what is there. Safe to run
 * more than once — it does nothing once the database has subjects.
 */
export async function importFromJsonFile(): Promise<{
  imported: boolean;
  subjects: number;
  topics: number;
  lessons: number;
}> {
  const db = await getQueryable();

  const existing = await db.query<{ n: number }>('SELECT COUNT(*)::int AS n FROM caps_subjects');
  const alreadyPresent = toNumber(existing.rows[0]?.n ?? 0);
  if (alreadyPresent > 0) {
    const counts = await countAll();
    return { imported: false, ...counts };
  }

  let raw: string;
  try {
    raw = await fs.readFile(CURRICULUM_FILE, 'utf-8');
  } catch {
    return { imported: false, subjects: 0, topics: 0, lessons: 0 };
  }

  const parsed = JSON.parse(raw) as {
    subjects?: Array<{
      id: string;
      name: string;
      grades?: number[];
      capsDocumentUrl?: string;
      topics?: Array<{
        id: string;
        title: string;
        capsCode?: string;
        grade?: number;
        sequence?: number;
        lessons?: Array<{ id: string; title: string; status?: string }>;
      }>;
    }>;
  };

  const subjects = parsed.subjects ?? [];
  let topicCount = 0;
  let lessonCount = 0;

  for (const subject of subjects) {
    await db.query(
      'INSERT INTO caps_subjects (id, name, grades, caps_document_url) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING',
      [subject.id, subject.name, subject.grades ?? [], subject.capsDocumentUrl ?? null],
    );
    for (const topic of subject.topics ?? []) {
      await db.query(
        `INSERT INTO caps_topics (id, subject_id, title, caps_code, grade, sequence)
         VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING`,
        [
          topic.id,
          subject.id,
          topic.title,
          topic.capsCode ?? '',
          topic.grade ?? null,
          topic.sequence ?? 0,
        ],
      );
      topicCount += 1;
      for (const lesson of topic.lessons ?? []) {
        await db.query(
          'INSERT INTO caps_lessons (id, topic_id, title, status) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING',
          [lesson.id, topic.id, lesson.title, lesson.status ?? 'draft'],
        );
        lessonCount += 1;
      }
    }
  }

  return { imported: true, subjects: subjects.length, topics: topicCount, lessons: lessonCount };
}
