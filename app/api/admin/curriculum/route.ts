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

/**
 * Edits. Kept deliberately narrow so the file stays valid: rename a subject,
 * or change a topic's title / CAPS code.
 */
export async function PATCH(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const action = body.action;

    const data = await readCurriculum();

    if (action === 'rename-subject') {
      const subjectId = cleanText(body.subjectId, 'subjectId', 200);
      const subject = data.subjects.find((item) => item.id === subjectId);
      if (!subject) {
        return apiError('ASSET_NOT_FOUND', 404, `No subject with id "${subjectId}"`);
      }
      subject.name = cleanText(body.name, 'name', 200);
      await writeCurriculum(data);
      return apiSuccess({ updated: 'subject', id: subjectId, name: subject.name });
    }

    if (action === 'update-topic') {
      const topicId = cleanText(body.topicId, 'topicId', 200);
      for (const subject of data.subjects) {
        const topic = (subject.topics ?? []).find((item) => item.id === topicId);
        if (!topic) continue;
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
      return apiError('ASSET_NOT_FOUND', 404, `No topic with id "${topicId}"`);
    }

    return apiError('INVALID_REQUEST', 400, `Unknown action "${String(action)}"`);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return apiError('INVALID_REQUEST', 400, message);
  }
}
