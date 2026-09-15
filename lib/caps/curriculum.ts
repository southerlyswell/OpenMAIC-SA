import { promises as fs } from 'node:fs';
import path from 'node:path';
import { getQueryable } from '@/lib/caps/db';

/**
 * CAPS map reads and writes — the only place that knows the SQL.
 *
 * See dev-library/requirements-storage-foundation.md. No curriculum content is
 * invented anywhere in this file; it stores and returns what Patrick enters.
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
    `SELECT id, subject_id, title, caps_code, sequence
       FROM caps_topics
      ORDER BY subject_id, sequence, title`,
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
) {
  const db = await getQueryable();
  const next = await db.query<{ next: number }>(
    'SELECT COALESCE(MAX(sequence), 0) + 1 AS next FROM caps_topics WHERE subject_id = $1',
    [subjectId],
  );
  await db.query(
    'INSERT INTO caps_topics (id, subject_id, title, caps_code, sequence) VALUES ($1, $2, $3, $4, $5)',
    [id, subjectId, title, capsCode, toNumber(next.rows[0]?.next ?? 1)],
  );
}

export async function updateTopic(id: string, title: string, capsCode: string) {
  const db = await getQueryable();
  await db.query('UPDATE caps_topics SET title = $2, caps_code = $3, updated_at = now() WHERE id = $1', [
    id,
    title,
    capsCode,
  ]);
}

export async function deleteTopic(id: string) {
  const db = await getQueryable();
  const result = await db.query<{ id: string }>(
    'DELETE FROM caps_topics WHERE id = $1 RETURNING id',
    [id],
  );
  return result.rows.length > 0;
}

/**
 * One-time import of the content Patrick already entered into
 * data/curriculum.json. Invents nothing: it copies what is there. Safe to run
 * more than once — existing ids are left alone.
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
        'INSERT INTO caps_topics (id, subject_id, title, caps_code, sequence) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING',
        [topic.id, subject.id, topic.title, topic.capsCode ?? '', topic.sequence ?? 0],
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
