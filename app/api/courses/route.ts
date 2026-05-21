import { NextRequest } from 'next/server';
import { createLogger } from '@/lib/logger';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { initSQLiteDB, getAllLessons, getPhases, getSubjectsByPhase, getTopicsBySubject } from '@/lib/db';

const log = createLogger('API Courses');

export async function GET(_req: NextRequest) {
  try {
    initSQLiteDB();

    // Get all lessons/courses
    const lessons = getAllLessons();
    const courses = lessons.map((lesson) => ({
      id: lesson.id,
      name: lesson.title,
      description: `${lesson.subject} — Grade ${lesson.grade}`,
      sceneCount: 0,
      createdAt: new Date(lesson.created_at).getTime(),
      updatedAt: new Date(lesson.updated_at).getTime(),
      grade: lesson.grade,
      subject: lesson.subject,
      language: lesson.language,
      status: lesson.status,
      version: lesson.version,
      classroomPath: lesson.classroom_json_path,
    }));

    // Build curriculum tree
    const phases = getPhases();
    const curriculum = phases.map((phase) => {
      const subjects = getSubjectsByPhase(phase.id);
      return {
        id: phase.id,
        name: phase.name,
        grades: phase.grades,
        subjects: subjects.map((subj) => {
          const topics = getTopicsBySubject(subj.id);
          return {
            id: subj.id,
            name: subj.name,
            grade: subj.grade,
            topics: topics.map((t) => ({
              id: t.id,
              title: t.title,
              capsCode: t.caps_code,
              sequence: t.sequence,
              learningOutcomes: t.learning_outcomes ? JSON.parse(t.learning_outcomes) : [],
            })),
          };
        }),
      };
    });

    return apiSuccess({ courses, curriculum });
  } catch (err) {
    log.error('Failed to list courses:', err);
    return apiError('INTERNAL_ERROR', 500, 'Failed to list courses');
  }
}
