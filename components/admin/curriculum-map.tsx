'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { BookOpen, Check, ChevronDown, ChevronRight, Layers, GraduationCap, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { createLogger } from '@/lib/logger';

const log = createLogger('CurriculumMap');

interface CurriculumTopic {
  id: string;
  title: string;
  capsCode?: string;
  sequence: number;
  hasCourse: boolean;
  learningOutcomes: string[];
}

interface CurriculumSubject {
  id: string;
  name: string;
  grade: number;
  courseCount: number;
  courses: string[];
  topics: CurriculumTopic[];
}

interface CurriculumPhase {
  id: string;
  name: string;
  grades: string;
  subjects: CurriculumSubject[];
}

export function CurriculumMap({ onGenerate }: {
  onGenerate?: (phase: string, grade: number, subject: string, topicIds: string[]) => void;
}) {
  const [phases, setPhases] = useState<CurriculumPhase[]>([]);
  const [selectedPhaseId, setSelectedPhaseId] = useState<string | null>(null);
  const [expandedSubjects, setExpandedSubjects] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchCurriculum();
  }, []);

  const fetchCurriculum = async () => {
    try {
      const res = await fetch('/api/curriculum');
      if (res.ok) {
        const data = await res.json();
        const loaded = data.phases || [];
        setPhases(loaded);
        if (loaded.length > 0 && !selectedPhaseId) {
          setSelectedPhaseId(loaded[0].id);
        }
      }
    } catch (err) {
      log.error('Failed to fetch curriculum:', err);
    } finally {
      setLoading(false);
    }
  };

  const toggleSubject = (id: string) => {
    setExpandedSubjects((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <div className="size-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  const selectedPhase = phases.find((p) => p.id === selectedPhaseId);
  const totalCourses = phases.reduce((a, p) => a + p.subjects.reduce((b, s) => b + s.courseCount, 0), 0);
  const totalSubjects = phases.reduce((a, p) => a + p.subjects.length, 0);

  return (
    <div>
      {/* Phase tabs */}
      <div className="flex flex-wrap gap-1.5 mb-4">
        {phases.map((phase) => {
          const phaseCourses = phase.subjects.reduce((a, s) => a + s.courseCount, 0);
          const isActive = selectedPhaseId === phase.id;
          return (
            <button
              key={phase.id}
              onClick={() => { setSelectedPhaseId(phase.id); setExpandedSubjects(new Set()); }}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all border',
                isActive
                  ? 'bg-primary/10 border-primary/30 text-primary'
                  : 'bg-card border-border/50 text-muted-foreground hover:border-border hover:text-foreground'
              )}
            >
              <Layers className="size-3" />
              {phase.name}
              <span className={cn(
                'text-[10px]',
                isActive ? 'text-primary/60' : 'text-muted-foreground/40'
              )}>
                {phaseCourses}
              </span>
            </button>
          );
        })}
      </div>

      {/* Summary bar */}
      <div className="flex items-center gap-4 mb-4 text-xs text-muted-foreground/60 px-1">
        <span>{totalCourses} courses</span>
        <span className="w-px h-3 bg-border/40" />
        <span>{totalSubjects} subjects across {phases.length} phases</span>
        {selectedPhase && (
          <>
            <span className="w-px h-3 bg-border/40" />
            <span className="text-primary/60">{selectedPhase.name}: Gr {selectedPhase.grades}</span>
          </>
        )}
      </div>

      {/* Selected phase content */}
      {selectedPhase && (
        <div>
          <div className="grid grid-cols-2 gap-2.5">
            {selectedPhase.subjects.map((subject) => {
              const isExpanded = expandedSubjects.has(subject.id);
              const hasTopics = subject.topics.length > 0;
              return (
                <div key={subject.id}>
                  <div
                    onClick={() => hasTopics && toggleSubject(subject.id)}
                    className={cn(
                      'rounded-xl border px-3.5 py-3 transition-all',
                      subject.courseCount > 0
                        ? 'border-emerald-500/20 bg-emerald-500/[0.03]'
                        : 'border-border/40 bg-card',
                      hasTopics && 'cursor-pointer hover:border-primary/30'
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-foreground/90 truncate">
                          {subject.name}
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <span className={cn(
                            'text-xs font-medium',
                            subject.courseCount > 0 ? 'text-emerald-500' : 'text-muted-foreground/40'
                          )}>
                            {subject.courseCount} course{subject.courseCount !== 1 ? 's' : ''}
                          </span>
                          <span className="text-[10px] text-muted-foreground/30">Gr {subject.grade}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0 ml-2">
                        {subject.courseCount === 0 && (
                          <button
                            onClick={(e) => { e.stopPropagation(); onGenerate?.(phase.id, subject.grade, subject.name, []); }}
                            className="px-2 py-1 rounded-lg text-[10px] font-medium border border-primary/30 bg-primary/5 text-primary hover:bg-primary/10 transition-colors"
                          >
                            Generate
                          </button>
                        )}
                        {hasTopics && (
                          <ChevronRight className={cn(
                            'size-4 text-muted-foreground/30 transition-transform duration-200',
                            isExpanded && 'rotate-90'
                          )} />
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Expandable topics */}
                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="ml-1 mt-1 space-y-0.5">
                          {subject.topics.map((topic) => (
                            <div
                              key={topic.id}
                              className={cn(
                                'px-3 py-1.5 rounded-lg text-xs border border-border/20 flex items-center justify-between',
                                topic.hasCourse ? 'bg-emerald-500/[0.04]' : 'bg-card'
                              )}
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                {topic.hasCourse ? (
                                  <Check className="size-3 text-emerald-500 shrink-0" />
                                ) : (
                                  <div className="size-3 shrink-0 rounded-full border-2 border-border/40" />
                                )}
                                <span className={cn(
                                  'truncate',
                                  topic.hasCourse ? 'text-foreground/70' : 'text-muted-foreground/50'
                                )}>
                                  {topic.sequence}. {topic.title}
                                </span>
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0 ml-2">
                                {topic.capsCode && (
                                  <span className="text-[9px] text-muted-foreground/30">CAPS {topic.capsCode}</span>
                                )}
                                {!topic.hasCourse && (
                                  <button
                                    onClick={() => onGenerate?.(phase.id, subject.grade, subject.name, [topic.id])}
                                    className="px-1.5 py-0.5 rounded text-[9px] font-medium text-primary bg-primary/5 hover:bg-primary/10 transition-colors"
                                  >
                                    Gen
                                  </button>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {phases.length === 0 && (
        <div className="text-center py-8 text-sm text-muted-foreground/40">
          No curriculum data loaded.
        </div>
      )}
    </div>
  );
}
