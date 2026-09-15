'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  GraduationCap,
  Layers,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { cn } from '@/lib/utils/cn';

/**
 * CAPS admin area — see dev-library/requirements-admin-interface.md.
 *
 * Purpose: Patrick sees how the CAPS curriculum is organised and can change it
 * himself. Subject -> grade -> topic -> lesson, with CAPS codes shown. He types
 * his own CAPS content; this screen invents none.
 *
 * LOCAL TOOL ONLY. Unauthenticated on purpose. The sign-in question is brought
 * to Patrick before anything here is exposed to the internet.
 */

const ALL_GRADES = [8, 9, 10, 11, 12];

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

type DialogKind = 'new-subject' | 'edit-subject' | 'new-topic' | 'edit-topic' | null;

async function callApi(payload: Record<string, unknown>) {
  const res = await fetch('/api/admin/curriculum', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.json();
  if (!res.ok || !body.success) {
    throw new Error(body?.error ?? `Request failed (${res.status})`);
  }
  return body;
}

export default function AdminPage() {
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [totals, setTotals] = useState<Totals>({ subjects: 0, topics: 0, lessons: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [selectedSubjectId, setSelectedSubjectId] = useState<string | null>(null);
  const [selectedGrade, setSelectedGrade] = useState<number | null>(null);
  const [expandedTopicId, setExpandedTopicId] = useState<string | null>(null);

  const [dialog, setDialog] = useState<DialogKind>(null);
  const [fieldName, setFieldName] = useState('');
  const [fieldCapsCode, setFieldCapsCode] = useState('');
  const [fieldGrades, setFieldGrades] = useState<number[]>(ALL_GRADES);
  const [confirmDelete, setConfirmDelete] = useState<
    { kind: 'subject' | 'topic'; id: string; label: string; children: number } | null
  >(null);

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

  function openNewSubject() {
    setDialog('new-subject');
    setFieldName('');
    setFieldGrades(ALL_GRADES);
  }

  function openEditSubject(subject: Subject) {
    setDialog('edit-subject');
    setFieldName(subject.name);
    setFieldGrades(subject.grades.length ? subject.grades : ALL_GRADES);
  }

  function openNewTopic() {
    if (!selectedSubject) return;
    setDialog('new-topic');
    setFieldName('');
    setFieldCapsCode('');
  }

  function openEditTopic(topic: Topic) {
    setDialog('edit-topic');
    setFieldName(topic.title);
    setFieldCapsCode(topic.capsCode ?? '');
  }

  async function saveDialog() {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      if (dialog === 'new-subject') {
        await callApi({ action: 'create-subject', name: fieldName, grades: fieldGrades });
        setNotice(`Added subject "${fieldName.trim()}".`);
      } else if (dialog === 'edit-subject' && selectedSubject) {
        await callApi({
          action: 'update-subject',
          subjectId: selectedSubject.id,
          name: fieldName,
          grades: fieldGrades,
        });
        setNotice(`Saved "${fieldName.trim()}".`);
      } else if (dialog === 'new-topic' && selectedSubject) {
        await callApi({
          action: 'create-topic',
          subjectId: selectedSubject.id,
          title: fieldName,
          capsCode: fieldCapsCode,
        });
        setNotice(`Added topic "${fieldName.trim()}".`);
      } else if (dialog === 'edit-topic' && expandedTopicId) {
        await callApi({
          action: 'update-topic',
          topicId: expandedTopicId,
          title: fieldName,
          capsCode: fieldCapsCode,
        });
        setNotice(`Saved "${fieldName.trim()}".`);
      }
      setDialog(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  }

  async function runDelete() {
    if (!confirmDelete) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      if (confirmDelete.kind === 'subject') {
        await callApi({ action: 'delete-subject', subjectId: confirmDelete.id });
        setNotice(`Deleted subject "${confirmDelete.label}".`);
        if (selectedSubjectId === confirmDelete.id) setSelectedSubjectId(null);
      } else {
        await callApi({ action: 'delete-topic', topicId: confirmDelete.id });
        setNotice(`Deleted topic "${confirmDelete.label}".`);
        if (expandedTopicId === confirmDelete.id) setExpandedTopicId(null);
      }
      setConfirmDelete(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete');
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
                Local tool. You type the content — this screen invents none of it.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void load()}
                className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm hover:bg-muted"
              >
                <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
                Reload
              </button>
              <button
                type="button"
                onClick={openNewSubject}
                className="inline-flex items-center gap-2 rounded-md bg-foreground px-3 py-2 text-sm text-background"
              >
                <Plus className="h-4 w-4" />
                New subject
              </button>
            </div>
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
          <div className="grid gap-6 md:grid-cols-[300px_1fr]">
            {/* Subjects */}
            <nav className="rounded-lg border border-border">
              <div className="border-b border-border px-4 py-3 text-sm font-medium">Subjects</div>
              <ul className="divide-y divide-border">
                {subjects.map((subject) => (
                  <li key={subject.id}>
                    <div
                      className={cn(
                        'flex items-center gap-2 px-3 py-2',
                        selectedSubjectId === subject.id && 'bg-muted',
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedSubjectId(subject.id);
                          setSelectedGrade(subject.grades[0] ?? null);
                          setExpandedTopicId(null);
                        }}
                        className="flex-1 text-left text-sm"
                      >
                        <span className="block">{subject.name}</span>
                        <span className="mt-1 block text-xs text-muted-foreground">
                          Grades {subject.grades.join(', ') || '—'} · {subject.topicCount} topics
                        </span>
                      </button>
                      <button
                        type="button"
                        title="Rename this subject"
                        onClick={() => {
                          setSelectedSubjectId(subject.id);
                          openEditSubject(subject);
                        }}
                        className="rounded border border-border p-1 hover:bg-background"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        title="Delete this subject"
                        onClick={() =>
                          setConfirmDelete({
                            kind: 'subject',
                            id: subject.id,
                            label: subject.name,
                            children: subject.topicCount,
                          })
                        }
                        className="rounded border border-border p-1 hover:bg-background"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </li>
                ))}
                {subjects.length === 0 && (
                  <li className="px-4 py-3 text-sm text-muted-foreground">
                    No subjects yet. Choose <span className="font-medium">New subject</span> to add
                    your first.
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
                    <button
                      type="button"
                      onClick={openNewTopic}
                      className="ml-auto inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted"
                    >
                      <Plus className="h-3 w-3" />
                      New topic
                    </button>
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
                                {topic.capsCode || 'no CAPS code'}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {topic.lessonCount} lesson{topic.lessonCount === 1 ? '' : 's'}
                              </span>
                              <button
                                type="button"
                                onClick={() => {
                                  setExpandedTopicId(topic.id);
                                  openEditTopic(topic);
                                }}
                                className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs hover:bg-muted"
                              >
                                <Pencil className="h-3 w-3" />
                                Edit
                              </button>
                              <button
                                type="button"
                                title="Delete this topic"
                                onClick={() =>
                                  setConfirmDelete({
                                    kind: 'topic',
                                    id: topic.id,
                                    label: topic.title,
                                    children: topic.lessonCount,
                                  })
                                }
                                className="rounded border border-border p-1 hover:bg-muted"
                              >
                                <Trash2 className="h-3 w-3" />
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
                        <li className="text-sm text-muted-foreground">
                          This subject has no topics yet. Choose{' '}
                          <span className="font-medium">New topic</span> to add one.
                        </li>
                      )}
                    </ul>
                  </div>
                </div>
              )}
            </section>
          </div>
        )}
      </div>

      {/* Create / edit dialog */}
      {dialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-lg border border-border bg-background p-5 shadow-lg">
            <h2 className="text-lg font-semibold">
              {dialog === 'new-subject' && 'New subject'}
              {dialog === 'edit-subject' && 'Edit subject'}
              {dialog === 'new-topic' && 'New topic'}
              {dialog === 'edit-topic' && 'Edit topic'}
            </h2>

            <label className="mt-4 block text-sm">
              {dialog.includes('subject') ? 'Subject name' : 'Topic title'}
              <input
                autoFocus
                value={fieldName}
                onChange={(event) => setFieldName(event.target.value)}
                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              />
            </label>

            {dialog.includes('subject') ? (
              <fieldset className="mt-4">
                <legend className="text-sm">Grades this subject covers</legend>
                <div className="mt-2 flex flex-wrap gap-2">
                  {ALL_GRADES.map((grade) => {
                    const on = fieldGrades.includes(grade);
                    return (
                      <button
                        key={grade}
                        type="button"
                        onClick={() =>
                          setFieldGrades((current) =>
                            current.includes(grade)
                              ? current.filter((value) => value !== grade)
                              : [...current, grade].sort((a, b) => a - b),
                          )
                        }
                        className={cn(
                          'rounded-full border border-border px-3 py-1 text-xs',
                          on && 'bg-foreground text-background',
                        )}
                      >
                        {grade}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            ) : (
              <label className="mt-4 block text-sm">
                CAPS code
                <input
                  value={fieldCapsCode}
                  onChange={(event) => setFieldCapsCode(event.target.value)}
                  className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                />
              </label>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDialog(null)}
                className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void saveDialog()}
                disabled={saving || !fieldName.trim()}
                className="rounded-md bg-foreground px-3 py-2 text-sm text-background disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-lg border border-border bg-background p-5 shadow-lg">
            <h2 className="text-lg font-semibold">
              Delete this {confirmDelete.kind}?
            </h2>
            <p className="mt-2 text-sm">
              <span className="font-medium">{confirmDelete.label}</span>
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              {confirmDelete.children > 0
                ? `This also deletes ${confirmDelete.children} ${
                    confirmDelete.kind === 'subject' ? 'topic' : 'lesson'
                  }${confirmDelete.children === 1 ? '' : 's'} inside it. This cannot be undone.`
                : 'This cannot be undone.'}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDelete(null)}
                className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void runDelete()}
                disabled={saving}
                className="rounded-md bg-destructive px-3 py-2 text-sm text-white disabled:opacity-50"
              >
                {saving ? 'Deleting…' : 'Delete'}
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
