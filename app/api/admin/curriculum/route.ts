import { promises as fs } from 'node:fs';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { apiError, apiSuccess } from '@/lib/server/api-response';

/**
 * CAPS curriculum admin API.
 *
 * Reads and writes data/curriculum.json — the editable source of truth for the
 * admin area. Deliberately simple and file-backed: local tool, no database
 * dependency, nothing published.
 *
 * Safety: this route is unauthenticated ON PURPOSE and is for local use only.
 * Before anything here is exposed on the internet, the sign-in question is
 * brought to Patrick (see dev-library/requirements-admin-interface.md).
 */

const CURRICULUM_PATH = path.join(process.cwd(), 'data', 'curriculum.json');

interface Lesson {
  id: string;
  title: string;
  status?: string;
}

interface Topic {
  id: string;
  title: string;
  capsCode?: string;
  sequence?: number;
  lessons?: Lesson[];
}

interface Subject {
  id: string;
  name: string;
  grades: number[];
  topics: Topic[];
  capsDocumentUrl?: string;
}

interface CurriculumFile {
  subjects: Subject[];
}

async function readCurriculum(): Promise<CurriculumFile> {
  const raw = await fs.readFile(CURRICULUM_PATH, 'utf-8');
  const parsed = JSON.parse(raw) as CurriculumFile;
  if (!parsed || !Array.isArray(parsed.subjects)) {
    throw new Error('curriculum.json must contain a "subjects" array');
  }
  return parsed;
}

/**
 * Write atomically: a temp file plus rename, so a crash mid-write cannot leave
 * a half-written curriculum file behind.
 */
async function writeCurriculum(data: CurriculumFile): Promise<void> {
  const tempPath = `${CURRICULUM_PATH}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(data, null, 2)}\n`, 'utf-8');
  await fs.rename(tempPath, CURRICULUM_PATH);
}

/** Only allow whole, printable text edits; reject anything that breaks the file. */
function cleanText(value: unknown, field: string, max = 300): string {
  if (typeof value !== 'string') {
    throw new Error(`${field} must be text`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${field} cannot be empty`);
  }
  if (trimmed.length > max) {
    throw new Error(`${field} is longer than ${max} characters`);
  }
  return trimmed;
}

/**
 * Build an id from a name. Ids are permanent keys, so they are derived once and
 * never regenerated on rename — an id that shifted under a rename would silently
 * orphan anything referring to it later.
 */
function makeId(name: string, existing: Set<string>): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'item';
  if (!existing.has(base)) return base;
  let counter = 2;
  while (existing.has(`${base}-${counter}`)) counter += 1;
  return `${base}-${counter}`;
}

function cleanGrades(value: unknown): number[] {
  if (!Array.isArray(value)) {
    throw new Error('grades must be a list');
  }
  const grades = [
    ...new Set(
      value.map((grade) => {
        const parsed = Number(grade);
        if (!Number.isInteger(parsed) || parsed < 1 || parsed > 12) {
          throw new Error(`"${String(grade)}" is not a school grade between 1 and 12`);
        }
        return parsed;
      }),
    ),
  ].sort((a, b) => a - b);
  if (grades.length === 0) {
    throw new Error('choose at least one grade');
  }
  return grades;
}

function findTopic(data: CurriculumFile, topicId: string): Topic | null {
  for (const subject of data.subjects) {
    const topic = (subject.topics ?? []).find((item) => item.id === topicId);
    if (topic) return topic;
  }
  return null;
}

export async function GET() {
  try {
    const data = await readCurriculum();

    const subjects = data.subjects.map((subject) => {
      const grades = [...(subject.grades ?? [])].sort((a, b) => a - b);
      const topics = [...(subject.topics ?? [])].sort(
        (a, b) => (a.sequence ?? 0) - (b.sequence ?? 0),
      );
      const lessonCount = topics.reduce((sum, topic) => sum + (topic.lessons?.length ?? 0), 0);
      return {
        id: subject.id,
        name: subject.name,
        grades,
        capsDocumentUrl: subject.capsDocumentUrl ?? null,
        topics: topics.map((topic) => ({
          id: topic.id,
          title: topic.title,
          capsCode: topic.capsCode ?? null,
          sequence: topic.sequence ?? 0,
          lessonCount: topic.lessons?.length ?? 0,
          lessons: (topic.lessons ?? []).map((lesson) => ({
            id: lesson.id,
            title: lesson.title,
            status: lesson.status ?? 'unknown',
          })),
        })),
        topicCount: topics.length,
        lessonCount,
      };
    });

    return apiSuccess({
      subjects,
      totals: {
        subjects: subjects.length,
        topics: subjects.reduce((sum, subject) => sum + subject.topicCount, 0),
        lessons: subjects.reduce((sum, subject) => sum + subject.lessonCount, 0),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return apiError('INTERNAL_ERROR', 500, `Could not read the curriculum file: ${message}`);
  }
}

/** Save an existing topic's title / CAPS code. */
async function updateTopic(data: CurriculumFile, body: Record<string, unknown>) {
  const topicId = cleanText(body.topicId, 'topicId', 200);
  const topic = findTopic(data, topicId);
  if (!topic) {
    return apiError('ASSET_NOT_FOUND', 404, `No topic with id "${topicId}"`);
  }
  if (body.title !== undefined) {
    topic.title = cleanText(body.title, 'title', 300);
  }
  if (body.capsCode !== undefined) {
    topic.capsCode = cleanText(body.capsCode, 'capsCode', 100);
  }
  await writeCurriculum(data);
  return apiSuccess({
    updated: 'topic',
    id: topicId,
    title: topic.title,
    capsCode: topic.capsCode ?? null,
  });
}

/** Create a subject. */
async function createSubject(data: CurriculumFile, body: Record<string, unknown>) {
  const name = cleanText(body.name, 'name', 200);
  const grades = cleanGrades(body.grades);
  const existingIds = new Set(data.subjects.map((subject) => subject.id));
  const id = makeId(name, existingIds);
  data.subjects.push({ id, name, grades, topics: [] });
  await writeCurriculum(data);
  return apiSuccess({ created: 'subject', id, name, grades });
}

/** Rename a subject and/or change the grades it covers. */
async function updateSubject(data: CurriculumFile, body: Record<string, unknown>) {
  const subjectId = cleanText(body.subjectId, 'subjectId', 200);
  const subject = data.subjects.find((item) => item.id === subjectId);
  if (!subject) {
    return apiError('ASSET_NOT_FOUND', 404, `No subject with id "${subjectId}"`);
  }
  if (body.name !== undefined) {
    subject.name = cleanText(body.name, 'name', 200);
  }
  if (body.grades !== undefined) {
    subject.grades = cleanGrades(body.grades);
  }
  await writeCurriculum(data);
  return apiSuccess({ updated: 'subject', id: subjectId, name: subject.name });
}

/** Create a topic inside a subject. */
async function createTopic(data: CurriculumFile, body: Record<string, unknown>) {
  const subjectId = cleanText(body.subjectId, 'subjectId', 200);
  const subject = data.subjects.find((item) => item.id === subjectId);
  if (!subject) {
    return apiError('ASSET_NOT_FOUND', 404, `No subject with id "${subjectId}"`);
  }
  const title = cleanText(body.title, 'title', 300);
  const capsCode = body.capsCode === undefined ? '' : cleanText(body.capsCode, 'capsCode', 100);
  subject.topics = subject.topics ?? [];
  const existingIds = new Set(subject.topics.map((topic) => topic.id));
  const id = makeId(title, existingIds);
  const nextSequence =
    subject.topics.reduce((max, topic) => Math.max(max, topic.sequence ?? 0), 0) + 1;
  subject.topics.push({ id, title, capsCode, sequence: nextSequence, lessons: [] });
  await writeCurriculum(data);
  return apiSuccess({ created: 'topic', id, title, capsCode, subjectId });
}

/** Delete a subject, its topics and their lessons. */
async function deleteSubject(data: CurriculumFile, body: Record<string, unknown>) {
  const subjectId = cleanText(body.subjectId, 'subjectId', 200);
  const index = data.subjects.findIndex((item) => item.id === subjectId);
  if (index === -1) {
    return apiError('ASSET_NOT_FOUND', 404, `No subject with id "${subjectId}"`);
  }
  const [removed] = data.subjects.splice(index, 1);
  const topics = removed.topics?.length ?? 0;
  await writeCurriculum(data);
  return apiSuccess({ deleted: 'subject', id: subjectId, name: removed.name, topicsDeleted: topics });
}

/** Delete a topic and its lessons. */
async function deleteTopic(data: CurriculumFile, body: Record<string, unknown>) {
  const topicId = cleanText(body.topicId, 'topicId', 200);
  for (const subject of data.subjects) {
    const topics = subject.topics ?? [];
    const index = topics.findIndex((topic) => topic.id === topicId);
    if (index === -1) continue;
    const [removed] = topics.splice(index, 1);
    await writeCurriculum(data);
    return apiSuccess({
      deleted: 'topic',
      id: topicId,
      title: removed.title,
      lessonsDeleted: removed.lessons?.length ?? 0,
    });
  }
  return apiError('ASSET_NOT_FOUND', 404, `No topic with id "${topicId}"`);
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const action = body.action;
    const data = await readCurriculum();

    switch (action) {
      case 'create-subject':
        return await createSubject(data, body);
      case 'update-subject':
        return await updateSubject(data, body);
      case 'create-topic':
        return await createTopic(data, body);
      case 'update-topic':
        return await updateTopic(data, body);
      case 'delete-subject':
        return await deleteSubject(data, body);
      case 'delete-topic':
        return await deleteTopic(data, body);
      default:
        return apiError('INVALID_REQUEST', 400, `Unknown action "${String(action)}"`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return apiError('INVALID_REQUEST', 400, message);
  }
}
