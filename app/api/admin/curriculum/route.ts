import { NextRequest } from 'next/server';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import {
  countAll,
  createSubject,
  createTopic,
  deleteSubject,
  deleteTopic,
  findSubject,
  findTopic,
  importFromJsonFile,
  listCurriculum,
  updateSubject,
  updateTopic,
} from '@/lib/caps/curriculum';

/**
 * CAPS curriculum admin API — now backed by the CAPS map database.
 *
 * Previously read/wrote data/curriculum.json. The JSON file is imported once and
 * then left alone as a backup; the database is the source of truth.
 * See dev-library/requirements-storage-foundation.md.
 *
 * Safety: this route is unauthenticated ON PURPOSE and is for local use only.
 * Before anything here is exposed on the internet, the sign-in question is
 * brought to Patrick.
 */

/** Only allow whole, printable text edits. */
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

/**
 * A topic's grade may be absent, which is a real state ("no grade set") rather
 * than an error — existing topics have no grade and are shown as unfinished.
 */
function cleanGrade(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 12) {
    throw new Error(`"${String(value)}" is not a school grade between 1 and 12`);
  }
  return parsed;
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

export async function GET() {
  try {
    // First call moves Patrick's existing content in from the JSON file. Runs at
    // most once; after that the database is the source of truth.
    await importFromJsonFile();

    const subjects = await listCurriculum();
    const totals = await countAll();

    return apiSuccess({ subjects, totals });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return apiError('INTERNAL_ERROR', 500, `Could not read the CAPS database: ${message}`);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const action = body.action;

    switch (action) {
      case 'create-subject': {
        const name = cleanText(body.name, 'name', 200);
        const grades = cleanGrades(body.grades);
        const existing = new Set((await listCurriculum()).map((subject) => subject.id));
        const id = makeId(name, existing);
        await createSubject(id, name, grades);
        return apiSuccess({ created: 'subject', id, name, grades });
      }

      case 'update-subject': {
        const subjectId = cleanText(body.subjectId, 'subjectId', 200);
        if (!(await findSubject(subjectId))) {
          return apiError('ASSET_NOT_FOUND', 404, `No subject with id "${subjectId}"`);
        }
        const name = cleanText(body.name, 'name', 200);
        const grades = cleanGrades(body.grades);
        await updateSubject(subjectId, name, grades);
        return apiSuccess({ updated: 'subject', id: subjectId, name });
      }

      case 'create-topic': {
        const subjectId = cleanText(body.subjectId, 'subjectId', 200);
        if (!(await findSubject(subjectId))) {
          return apiError('ASSET_NOT_FOUND', 404, `No subject with id "${subjectId}"`);
        }
        const title = cleanText(body.title, 'title', 300);
        const capsCode = body.capsCode === undefined ? '' : cleanText(body.capsCode, 'capsCode', 100);
        const grade = cleanGrade(body.grade);
        const curriculum = await listCurriculum();
        const subject = curriculum.find((item) => item.id === subjectId);
        const existing = new Set((subject?.topics ?? []).map((topic) => topic.id));
        const id = makeId(title, existing);
        await createTopic(id, subjectId, title, capsCode, grade);
        return apiSuccess({ created: 'topic', id, title, capsCode, grade, subjectId });
      }

      case 'update-topic': {
        const topicId = cleanText(body.topicId, 'topicId', 200);
        if (!(await findTopic(topicId))) {
          return apiError('ASSET_NOT_FOUND', 404, `No topic with id "${topicId}"`);
        }
        const title = cleanText(body.title, 'title', 300);
        const capsCode = body.capsCode === undefined ? '' : cleanText(body.capsCode, 'capsCode', 100);
        const grade = cleanGrade(body.grade);
        await updateTopic(topicId, title, capsCode, grade);
        return apiSuccess({ updated: 'topic', id: topicId, title, capsCode, grade });
      }

      case 'delete-subject': {
        const subjectId = cleanText(body.subjectId, 'subjectId', 200);
        const curriculum = await listCurriculum();
        const subject = curriculum.find((item) => item.id === subjectId);
        if (!subject) {
          return apiError('ASSET_NOT_FOUND', 404, `No subject with id "${subjectId}"`);
        }
        await deleteSubject(subjectId);
        return apiSuccess({
          deleted: 'subject',
          id: subjectId,
          name: subject.name,
          topicsDeleted: subject.topicCount,
        });
      }

      case 'delete-topic': {
        const topicId = cleanText(body.topicId, 'topicId', 200);
        const curriculum = await listCurriculum();
        let found: { title: string; lessonCount: number } | null = null;
        for (const subject of curriculum) {
          const topic = subject.topics.find((item) => item.id === topicId);
          if (topic) {
            found = { title: topic.title, lessonCount: topic.lessonCount };
            break;
          }
        }
        if (!found) {
          return apiError('ASSET_NOT_FOUND', 404, `No topic with id "${topicId}"`);
        }
        await deleteTopic(topicId);
        return apiSuccess({
          deleted: 'topic',
          id: topicId,
          title: found.title,
          lessonsDeleted: found.lessonCount,
        });
      }

      default:
        return apiError('INVALID_REQUEST', 400, `Unknown action "${String(action)}"`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return apiError('INVALID_REQUEST', 400, message);
  }
}
