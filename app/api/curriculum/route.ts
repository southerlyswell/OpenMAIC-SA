import { NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import { getDB } from '@/lib/db';

/** GET /api/curriculum — full curriculum tree with course counts per topic */
export async function GET() {
  try {
    const raw = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), 'data', 'curriculum.json'), 'utf-8')
    );

    // Get all course subject/grade combos from SQLite
    const db = getDB();
    const courses = db.prepare(
      `SELECT grade, subject, title FROM lessons ORDER BY grade, subject`
    ).all() as Array<{ grade: number; subject: string; title: string }>;

    // Build a lookup: "grade-subject" → course titles
    const courseLookup = new Map<string, string[]>();
    for (const c of courses) {
      const key = `${c.grade}-${c.subject}`;
      if (!courseLookup.has(key)) courseLookup.set(key, []);
      courseLookup.get(key)!.push(c.title);
    }

    // Build curriculum tree with course counts per topic
    const phases = (raw.phases || []).map((phase: any) => ({
      id: phase.id,
      name: phase.name,
      grades: phase.grades,
      subjects: [] as Array<{
        id: string;
        name: string;
        grade: number;
        courseCount: number;
        courses: string[];
        topics: Array<{
          id: string;
          title: string;
          capsCode?: string;
          sequence: number;
          hasCourse: boolean;
          learningOutcomes: string[];
        }>;
      }>,
    }));

    const subjects = raw.subjects || [];
    const topics = raw.topics || [];

    for (const phase of phases) {
      for (const subj of subjects.filter((s: any) => s.phase_id === phase.id)) {
        const subjectTopics = topics
          .filter((t: any) => t.subject_id === subj.id)
          .map((t: any) => ({
            id: t.id,
            title: t.title,
            capsCode: t.caps_code || t.capsCode,
            sequence: t.sequence || 0,
            learningOutcomes: t.learning_outcomes || t.learningOutcomes || [],
            hasCourse: false,
          }))
          .sort((a: any, b: any) => a.sequence - b.sequence);

        const key = `${subj.grade}-${subj.name}`;
        const existingCourses = courseLookup.get(key) || [];

        // Mark topics that have courses (by title match)
        for (const topic of subjectTopics) {
          topic.hasCourse = existingCourses.some((title) =>
            title.toLowerCase().includes(topic.title.toLowerCase()) ||
            topic.title.toLowerCase().includes(title.toLowerCase())
          );
        }

        phase.subjects.push({
          id: subj.id,
          name: subj.name,
          grade: subj.grade,
          courseCount: existingCourses.length,
          courses: existingCourses,
          topics: subjectTopics,
        });
      }

      // Sort subjects by grade then name
      phase.subjects.sort((a: any, b: any) => {
        if (a.grade !== b.grade) return a.grade - b.grade;
        return a.name.localeCompare(b.name);
      });
    }

    // Sort phases by custom order
    const phaseOrder = ['foundation', 'intermediate', 'senior', 'fet'];
    phases.sort((a: any, b: any) => phaseOrder.indexOf(a.id) - phaseOrder.indexOf(b.id));

    return NextResponse.json({ phases, totalCourses: courses.length });
  } catch (err: any) {
    console.error('Curriculum API error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
