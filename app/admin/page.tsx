'use client';

import { useCallback, useEffect, useState } from 'react';
import { BookOpen, ChevronDown, ChevronRight, GraduationCap, Layers, Pencil, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

/**
 * CAPS admin area — see dev-library/requirements-admin-interface.md.
 *
 * Purpose: Patrick sees how the CAPS curriculum is organised and can change it
 * himself. Subject → grade → topic → lesson, with CAPS codes shown.
 *
 * LOCAL TOOL ONLY. Unauthenticated on purpose. The sign-in question is brought
 * to Patrick before anything here is exposed to the internet.
 */

interface Lesson {
  id: string;
  title: string;
  status: string;
}

interface Topic {
  id: string;
  title: string;
  capsCode: string | null;
  sequence: number;
  lessonCount: number;
  lessons: Lesson[];
}

interface Subject {
  id: string;
  name: string;
  grades: number[];
  capsDocumentUrl: string | null;
  topics: Topic[];
  topicCount: number;
  lessonCount: number;
}

interface Totals {
  subjects: number;
  topics: number;
  lessons: number;
}

export default function AdminPage() {
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [totals, setTotals] = useState<Totals>({ subjects: 0, topics: 0, lessons: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [selectedSubjectId, setSelectedSubjectId] = useState<string | null>(null);
  const [selectedGrade, setSelectedGrade] = useState<number | null>(null);
  const [expandedTopicId, setExpandedTopicId] = useState<string | null>(null);

  const [editingTopic, setEditingTopic] = useState<Topic | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editCapsCode, setEditCapsCode] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/curriculum');
      const body = await res.json();
      if (!res.ok || !body.success) {
        throw new Error(body?.error ?? `Request failed (${res.status})`);
      }
      setSubjects(body.subjects ?? []);
      setTotals(body.totals ?? { subjects: 0, topics: 0, lessons: 0 });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the curriculum');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedSubject = subjects.find((subject) => subject.id === selectedSubjectId) ?? null;

  // Topics belong to the subject as a whole right now; the data shape does not
  // yet split topics by grade. The grade selector is shown because Patrick asked
  // for subject -> grade -> topic, and it becomes meaningful when the real CAPS
  // data carries a grade per topic.
  const visibleTopics = selectedSubject?.topics ?? [];

  function openTopicEditor(topic: Topic) {
    setEditingTopic(topic);
    setEditTitle(topic.title);
    setEditCapsCode(topic.capsCode ?? '');
  }

  async function saveTopic() {
    if (!editingTopic) return;
    setSaving(true);
    setNotice(null);
    try {
      const res = await fetch('/api/admin/curriculum', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update-topic',
          topicId: editingTopic.id,
          title: editTitle,
          capsCode: editCapsCode,
        }),
      });
      const body = await res.json();
      if (!res.ok || !body.success) {
        throw new Error(body?.error ?? `Save failed (${res.status})`);
      }
      setNotice(`Saved "${body.title}".`);
      setEditingTopic(null);
      await load();
    } catch (err) {
      setNotice(null);
      setError(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-5xl px-6 py-8">
        <header className="mb-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">CAPS curriculum admin</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Local tool. Structure only — no course content. See the requirements document.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void load()}
              className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm hover:bg-muted"
            >
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
              Reload
            </button>
          </div>

          <div className="mt-4 flex flex-wrap gap-2 text-sm">
            <Stat icon={<BookOpen className="h-4 w-4" />} label="Subjects" value={totals.subjects} />
            <Stat icon={<Layers className="h-4 w-4" />} label="Topics" value={totals.topics} />
            <Stat icon={<GraduationCap className="h-4 w-4" />} label="Lessons" value={totals.lessons} />
          </div>
        </header>

        {error && (
          <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
            {error}
          </div>
        )}
        {notice && (
          <div className="mb-4 rounded-md border border-border bg-muted px-4 py-3 text-sm">{notice}</div>
        )}

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading curriculum…</p>
        ) : (
          <div className="grid gap-6 md:grid-cols-[280px_1fr]">
            {/* Subjects */}
            <nav className="rounded-lg border border-border">
              <div className="border-b border-border px-4 py-3 text-sm font-medium">Subjects</div>
              <ul className="divide-y divide-border">
                {subjects.map((subject) => (
                  <li key={subject.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedSubjectId(subject.id);
                        setSelectedGrade(subject.grades[0] ?? null);
                        setExpandedTopicId(null);
                      }}
                      className={cn(
                        'w-full px-4 py-3 text-left text-sm hover:bg-muted',
                        selectedSubjectId === subject.id && 'bg-muted font-medium',
                      )}
                    >
                      <span className="block">{subject.name}</span>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        Grades {subject.grades.join(', ')} · {subject.topicCount} topics
                      </span>
                    </button>
                  </li>
                ))}
                {subjects.length === 0 && (
                  <li className="px-4 py-3 text-sm text-muted-foreground">
                    The curriculum file has no subjects.
                  </li>
                )}
              </ul>
            </nav>

            {/* Drill-down */}
            <section className="rounded-lg border border-border">
              {!selectedSubject ? (
                <p className="px-4 py-6 text-sm text-muted-foreground">
                  Select a subject to see its grades and topics.
                </p>
              ) : (
                <div>
                  <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
                    <span className="text-sm font-medium">{selectedSubject.name}</span>
                    <span className="text-xs text-muted-foreground">Grade:</span>
                    {selectedSubject.grades.map((grade) => (
                      <button
                        key={grade}
                        type="button"
                        onClick={() => setSelectedGrade(grade)}
                        className={cn(
                          'rounded-full border border-border px-3 py-1 text-xs hover:bg-muted',
                          selectedGrade === grade && 'bg-foreground text-background',
                        )}
                      >
                        {grade}
                      </button>
                    ))}
                  </div>

                  <div className="px-4 py-3">
                    <p className="mb-3 text-xs uppercase tracking-wide text-muted-foreground">
                      Topics — Grade {selectedGrade ?? '—'}
                    </p>
                    <ul className="space-y-2">
                      {visibleTopics.map((topic) => {
                        const expanded = expandedTopicId === topic.id;
                        return (
                          <li key={topic.id} className="rounded-md border border-border">
                            <div className="flex items-center gap-2 px-3 py-2">
                              <button
                                type="button"
                                onClick={() => setExpandedTopicId(expanded ? null : topic.id)}
                                className="flex flex-1 items-center gap-2 text-left"
                              >
                                {expanded ? (
                                  <ChevronDown className="h-4 w-4 shrink-0" />
                                ) : (
                                  <ChevronRight className="h-4 w-4 shrink-0" />
                                )}
                                <span className="text-sm">{topic.title}</span>
                              </button>
                              <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                                {topic.capsCode ?? 'no CAPS code'}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {topic.lessonCount} lesson{topic.lessonCount === 1 ? '' : 's'}
                              </span>
                              <button
                                type="button"
                                onClick={() => openTopicEditor(topic)}
                                className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs hover:bg-muted"
                              >
                                <Pencil className="h-3 w-3" />
                                Edit
                              </button>
                            </div>
                            {expanded && (
                              <div className="border-t border-border px-9 py-2">
                                {topic.lessons.length === 0 ? (
                                  <p className="text-xs text-muted-foreground">
                                    No lessons attached to this topic yet.
                                  </p>
                                ) : (
                                  <ul className="space-y-1">
                                    {topic.lessons.map((lesson) => (
                                      <li key={lesson.id} className="text-sm">
                                        {lesson.title}
                                        <span className="ml-2 text-xs text-muted-foreground">
                                          {lesson.status}
                                        </span>
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </div>
                            )}
                          </li>
                        );
                      })}
                      {visibleTopics.length === 0 && (
                        <li className="text-sm text-muted-foreground">This subject has no topics.</li>
                      )}
                    </ul>
                  </div>
                </div>
              )}
            </section>
          </div>
        )}
      </div>

      {/* Topic editor */}
      {editingTopic && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-lg border border-border bg-background p-5 shadow-lg">
            <h2 className="text-lg font-semibold">Edit topic</h2>
            <p className="mt-1 text-xs text-muted-foreground">{editingTopic.id}</p>

            <label className="mt-4 block text-sm">
              Title
              <input
                value={editTitle}
                onChange={(event) => setEditTitle(event.target.value)}
                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              />
            </label>

            <label className="mt-4 block text-sm">
              CAPS code
              <input
                value={editCapsCode}
                onChange={(event) => setEditCapsCode(event.target.value)}
                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              />
            </label>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditingTopic(null)}
                className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void saveTopic()}
                disabled={saving}
                className="rounded-md bg-foreground px-3 py-2 text-sm text-background disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5">
      {icon}
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </span>
  );
}
