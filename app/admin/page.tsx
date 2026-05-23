'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'motion/react';
import { Trash2, ExternalLink, RefreshCw, Calendar, BookOpen, Layers, GraduationCap, AlertTriangle, Settings } from 'lucide-react';
import { createLogger } from '@/lib/logger';
import { CourseGenerator } from '@/components/admin-course-generator'
import { CurriculumMap } from '@/components/admin/curriculum-map'
import { CreatorModeToggle } from '@/components/creator-mode-toggle';
import { SettingsDialog } from '@/components/settings';
import type { SettingsSection } from '@/lib/types/settings';
import { useSettingsStore } from '@/lib/store/settings';

const log = createLogger('Admin');

interface AdminCourse {
  id: string;
  title: string;
  grade: number;
  subject: string;
  status: string;
  scene_types: string[];
  duration_min: number;
  created_at: string;
  updated_at: string;
  version: number;
  classroom_json_path: string;
}

interface CurriculumStats {
  phases: number;
  subjects: number;
  topics: number;
}

export default function AdminPage() {
  const router = useRouter();
  const [courses, setCourses] = useState<AdminCourse[]>([]);
  const [stats, setStats] = useState<CurriculumStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSection | undefined>(undefined);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/courses');
      if (res.ok) {
        const data = await res.json();
        setCourses(data.courses || []);
        setStats(data.stats || null);
      }
    } catch (err) {
      log.error('Failed to fetch admin data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/admin/courses?id=${id}`, { method: 'DELETE' });
      if (res.ok) {
        setCourses((prev) => prev.filter((c) => c.id !== id));
        setActionMsg(`Deleted course ${id}`);
        setDeleteConfirm(null);
        setTimeout(() => setActionMsg(null), 3000);
      }
    } catch (err) {
      log.error('Delete failed:', err);
    }
  };

  const handleRegenMetadata = async (id: string) => {
    try {
      const res = await fetch(`/api/admin/courses?id=${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'refresh-metadata' }),
      });
      if (res.ok) {
        setActionMsg(`Refreshed metadata for ${id}`);
        fetchData();
        setTimeout(() => setActionMsg(null), 3000);
      }
    } catch (err) {
      log.error('Refresh failed:', err);
    }
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString('en-ZA', {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-border/40 bg-background/80 backdrop-blur-sm">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push('/')}
              className="text-sm text-muted-foreground/60 hover:text-foreground transition-colors"
            >
              ← Home
            </button>
            <h1 className="text-lg font-semibold">Admin Dashboard</h1>
          </div>
          <div className="flex items-center gap-2">
            <CreatorModeToggle />
            <button
              onClick={() => setSettingsOpen(true)}
              className="p-2 rounded-full text-muted-foreground/40 hover:text-foreground/80 hover:bg-accent/50 transition-all"
              title="Settings"
            >
              <Settings className="size-4" />
            </button>
            <button
              onClick={fetchData}
              className="flex items-center gap-1.5 text-xs text-muted-foreground/60 hover:text-foreground transition-colors"
            >
              <RefreshCw className="size-3.5" />
              Refresh
            </button>
          </div>
        </div>
      </header>

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={(open) => {
          setSettingsOpen(open);
          if (!open) setSettingsSection(undefined);
        }}
        initialSection={settingsSection}
      />

      <main className="max-w-6xl mx-auto px-4 py-8 space-y-8">
        {/* Action toast */}
        {actionMsg && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="fixed top-16 right-4 z-50 px-4 py-2 rounded-lg bg-primary/10 border border-primary/20 text-sm text-primary"
          >
            {actionMsg}
          </motion.div>
        )}

        {/* Stats cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard icon={BookOpen} label="Courses" value={courses.length} />
          <StatCard icon={Layers} label="Phases" value={stats?.phases ?? '-'} />
          <StatCard icon={GraduationCap} label="Subjects" value={stats?.subjects ?? '-'} />
          <StatCard icon={AlertTriangle} label="Topics" value={stats?.topics ?? '-'} />
        </div>

        {/* Curriculum Map + Generator - split layout */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left: Coverage map */}
          <div className="rounded-xl border border-border/40 bg-card p-5">
            <h2 className="text-sm font-semibold text-foreground/80 mb-4 flex items-center gap-2">
              <Layers className="size-4 text-muted-foreground/40" />
              Curriculum Coverage
            </h2>
            <CurriculumMap onGenerate={(phase, grade, subject, topicIds) => {
              // TODO: wire to topic-aware generator
              console.log('Generate:', phase, grade, subject, topicIds);
            }} />
          </div>

          {/* Right: Generator */}
          <div>
            <CourseGenerator onCourseGenerated={fetchData} />
          </div>
        </div>

        {/* Courses table */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-medium text-muted-foreground/80">Generated Courses</h2>
            <span className="text-[11px] text-muted-foreground/40">{courses.length} total</span>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="size-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
            </div>
          ) : courses.length === 0 ? (
            <div className="text-center py-16">
              <BookOpen className="size-8 mx-auto text-muted-foreground/20 mb-3" />
              <p className="text-sm text-muted-foreground/40">No courses generated yet</p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border/40">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/30 bg-muted/30">
                    <th className="text-left px-4 py-3 text-[11px] uppercase tracking-wider text-muted-foreground/50 font-medium">Title</th>
                    <th className="text-left px-4 py-3 text-[11px] uppercase tracking-wider text-muted-foreground/50 font-medium">Grade</th>
                    <th className="text-left px-4 py-3 text-[11px] uppercase tracking-wider text-muted-foreground/50 font-medium">Subject</th>
                    <th className="text-left px-4 py-3 text-[11px] uppercase tracking-wider text-muted-foreground/50 font-medium">Status</th>
                    <th className="text-left px-4 py-3 text-[11px] uppercase tracking-wider text-muted-foreground/50 font-medium">Scenes</th>
                    <th className="text-left px-4 py-3 text-[11px] uppercase tracking-wider text-muted-foreground/50 font-medium">Duration</th>
                    <th className="text-left px-4 py-3 text-[11px] uppercase tracking-wider text-muted-foreground/50 font-medium">Created</th>
                    <th className="text-right px-4 py-3 text-[11px] uppercase tracking-wider text-muted-foreground/50 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {courses.map((course) => (
                    <motion.tr
                      key={course.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="border-b border-border/10 hover:bg-muted/20 transition-colors"
                    >
                      <td className="px-4 py-3 font-medium">{course.title}</td>
                      <td className="px-4 py-3 text-muted-foreground/60">
                        {course.grade > 0 ? `Grade ${course.grade}` : '—'}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground/60">{course.subject}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
                          course.status === 'published'
                            ? 'bg-green-500/10 text-green-600'
                            : course.status === 'draft'
                            ? 'bg-yellow-500/10 text-yellow-600'
                            : 'bg-red-500/10 text-red-600'
                        }`}>
                          {course.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground/60">
                        {course.scene_types?.length ?? '-'}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground/60">
                        {course.duration_min} min
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground/40 whitespace-nowrap">
                        <span className="flex items-center gap-1">
                          <Calendar className="size-3" />
                          {formatDate(course.created_at)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => router.push(`/classroom/${course.id}`)}
                            className="p-1.5 rounded-md hover:bg-accent/50 transition-colors text-muted-foreground/40 hover:text-foreground/80"
                            title="Open course"
                          >
                            <ExternalLink className="size-3.5" />
                          </button>
                          <button
                            onClick={() => handleRegenMetadata(course.id)}
                            className="p-1.5 rounded-md hover:bg-accent/50 transition-colors text-muted-foreground/40 hover:text-foreground/80"
                            title="Refresh metadata from JSON file"
                          >
                            <RefreshCw className="size-3.5" />
                          </button>
                          {deleteConfirm === course.id ? (
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => handleDelete(course.id)}
                                className="px-2 py-1 rounded-md bg-destructive/10 text-destructive text-xs font-medium hover:bg-destructive/20 transition-colors"
                              >
                                Confirm
                              </button>
                              <button
                                onClick={() => setDeleteConfirm(null)}
                                className="px-2 py-1 rounded-md text-muted-foreground/40 text-xs hover:text-foreground/80 transition-colors"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setDeleteConfirm(course.id)}
                              className="p-1.5 rounded-md hover:bg-accent/50 transition-colors text-muted-foreground/40 hover:text-destructive/80"
                              title="Delete course"
                            >
                              <Trash2 className="size-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

function StatCard({ icon: Icon, label, value }: { icon: any; label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-border/40 p-4 bg-card">
      <div className="flex items-center gap-2 mb-2">
        <Icon className="size-4 text-muted-foreground/40" />
        <span className="text-[11px] text-muted-foreground/50 uppercase tracking-wider">{label}</span>
      </div>
      <p className="text-2xl font-semibold">{value}</p>
    </div>
  );
}
