'use client';

import { useState, useEffect, useRef } from 'react';
import { BookOpen, GraduationCap, Layers, Search, ArrowUpDown } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { createLogger } from '@/lib/logger';
import { cn } from '@/lib/utils';

const log = createLogger('CurriculumBrowser');

interface Topic {
  id: string;
  title: string;
  capsCode: string;
  sequence: number;
  learningOutcomes: string[];
}

interface Subject {
  id: string;
  name: string;
  grade: number;
  topics: Topic[];
}

interface Phase {
  id: string;
  name: string;
  grades: string;
  subjects: Subject[];
}

interface CurriculumData {
  curriculum: Phase[];
}

type SortMode = 'popular' | 'newest' | 'az';

interface FilterState {
  grade?: number;
  subject?: string;
  search?: string;
  sort?: SortMode;
}

export function CurriculumBrowser({ onFilterChange, classrooms }: {
  onFilterChange?: (filter: FilterState | null) => void;
  classrooms?: Array<{ grade?: number; subject?: string }>;
}) {
  const [phases, setPhases] = useState<Phase[]>([]);
  const [selectedPhase, setSelectedPhase] = useState<string | null>(null);
  const [selectedGrade, setSelectedGrade] = useState<number | null>(null);
  const [selectedSubject, setSelectedSubject] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('popular');
  const [loading, setLoading] = useState(true);
  const [phaseOpen, setPhaseOpen] = useState(false);
  const [subjectOpen, setSubjectOpen] = useState(false);
  const phaseDropdownRef = useRef<HTMLDivElement>(null);
  const subjectDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchCurriculum();
  }, []);

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (phaseDropdownRef.current && !phaseDropdownRef.current.contains(e.target as Node)) {
        setPhaseOpen(false);
      }
      if (subjectDropdownRef.current && !subjectDropdownRef.current.contains(e.target as Node)) {
        setSubjectOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const fetchCurriculum = async () => {
    try {
      const res = await fetch('/api/courses');
      if (res.ok) {
        const data: CurriculumData = await res.json();
        setPhases(data.curriculum || []);
      }
    } catch (err) {
      log.error('Failed to fetch curriculum:', err);
    } finally {
      setLoading(false);
    }
  };

  // Build phase display name with grade range
  const phaseDisplayName = (phase: Phase) => {
    return `${phase.name} (Gr ${phase.grades})`;
  };

  const selectedPhaseData = phases.find((p) => p.id === selectedPhase);

  // All subjects for the selected phase that actually have courses
  // Derived from the classrooms prop (actual courses), not curriculum data
  const allPhaseSubjects = selectedPhase && classrooms
    ? Array.from(
        new Map(
          classrooms
            .filter(c => {
              // Match grade within this phase's grade range
              const phaseGrades = selectedPhaseData?.grades.split(',').map(g => parseInt(g.trim(), 10)) || [];
              return c.grade != null && phaseGrades.includes(c.grade);
            })
            .filter(c => c.subject)
            .map(s => [s.subject, { id: s.subject, name: s.subject! }])
        ).values()
      ).sort((a, b) => a.name.localeCompare(b.name))
    : [];

  // All grades for the selected phase
  const availableGrades = selectedPhaseData
    ? selectedPhaseData.grades
        .split(',')
        .map((g) => parseInt(g.trim(), 10))
        .filter((g) => !isNaN(g))
    : [];

  const selectedGradeSubjects = selectedPhaseData
    ? selectedPhaseData.subjects.filter((s) => s.grade === selectedGrade)
    : [];

  const notifyFilter = () => {
    const filter: FilterState = {};
    if (selectedGrade != null) filter.grade = selectedGrade;
    if (selectedSubject) filter.subject = selectedSubject;
    if (searchQuery.trim()) filter.search = searchQuery.trim();
    if (sortMode !== 'popular') filter.sort = sortMode;
    onFilterChange?.(Object.keys(filter).length > 0 ? filter : null);
  };

  const selectPhaseGrade = (phaseId: string, grade: number) => {
    setSelectedPhase(phaseId);
    setSelectedGrade(grade);
    setSelectedSubject(null);
    setPhaseOpen(false);
  };

  const selectSubject = (subjectName: string) => {
    if (selectedSubject === subjectName) {
      setSelectedSubject(null);
    } else {
      setSelectedSubject(subjectName);
    }
  };

  // Notify on filter changes
  useEffect(() => {
    notifyFilter();
  }, [selectedPhase, selectedGrade, selectedSubject, searchQuery, sortMode]);

  if (loading) {
    return (
      <div className="mt-8 flex items-center justify-center">
        <div className="size-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="mt-8 w-full max-w-2xl mx-auto">
      {/* ═══ Row 1: Search + Sort ═══ */}
      <div className="flex gap-3 mb-3">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground/40" />
          <input
            type="text"
            placeholder="Search courses..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full h-10 pl-9 pr-4 rounded-xl border border-border/50 bg-card text-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/40 focus:ring-1 focus:ring-primary/20 transition-all"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/30 hover:text-muted-foreground/60 text-xs"
            >
              ✕
            </button>
          )}
        </div>

        {/* Sort dropdown */}
        <div className="relative">
          <button
            onClick={() => setSubjectOpen(false)}
            className="h-10 px-4 rounded-xl border border-border/50 bg-card text-sm text-muted-foreground hover:text-foreground hover:border-border transition-all flex items-center gap-1.5 whitespace-nowrap"
          >
            <ArrowUpDown className="size-3.5" />
            {sortMode === 'popular' ? 'Popular' : sortMode === 'newest' ? 'Newest' : 'A–Z'}
          </button>
        </div>
      </div>

      {/* ═══ Row 2: Phase & Grade dropdown + Subject dropdown ═══ */}
      <div className="flex gap-3 mb-3">
        {/* Phase & Grade combined dropdown */}
        <div className="flex-1 relative" ref={phaseDropdownRef}>
          <button
            onClick={() => { setPhaseOpen(!phaseOpen); setSubjectOpen(false); }}
            className={cn(
              'w-full h-10 px-4 rounded-xl border text-sm text-left flex items-center gap-2 transition-all',
              selectedPhase
                ? 'border-primary/30 bg-primary/5 text-primary'
                : 'border-border/50 bg-card text-muted-foreground hover:border-border'
            )}
          >
            <Layers className="size-3.5 shrink-0" />
            <span className="flex-1 truncate">
              {selectedPhase && selectedGrade != null
                ? `${selectedPhaseData?.name} — Grade ${selectedGrade}`
                : 'Select Phase & Grade'}
            </span>
            <svg className="size-3.5 shrink-0 opacity-50" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 9 6 6 6-6"/></svg>
          </button>

          <AnimatePresence>
            {phaseOpen && (
              <motion.div
                initial={{ opacity: 0, y: -4, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -4, scale: 0.97 }}
                transition={{ duration: 0.12 }}
                className="absolute top-full mt-1 left-0 right-0 z-50 bg-card border border-border/50 rounded-xl shadow-lg overflow-hidden"
              >
                {[...phases].sort((a, b) => {
                  const order = ['foundation', 'intermediate', 'senior', 'fet'];
                  return order.indexOf(a.id) - order.indexOf(b.id);
                }).map((phase) => {
                  const grades = phase.grades
                    .split(',')
                    .map((g) => parseInt(g.trim(), 10))
                    .filter((g) => !isNaN(g))
                    .sort((a, b) => a - b);
                  return (
                    <div key={phase.id}>
                      <div className="px-3 py-1.5 text-[11px] font-semibold text-muted-foreground/50 uppercase tracking-wider bg-muted/30">
                        {phase.name}
                      </div>
                      <div className="flex flex-wrap gap-1 p-2">
                        {grades.map((grade) => {
                          const isActive = selectedPhase === phase.id && selectedGrade === grade;
                          return (
                            <button
                              key={grade}
                              onClick={() => selectPhaseGrade(phase.id, grade)}
                              className={cn(
                                'px-3 py-1.5 rounded-lg text-xs font-medium transition-all border flex items-center gap-1',
                                isActive
                                  ? 'bg-primary/10 border-primary/30 text-primary'
                                  : 'bg-muted/40 border-transparent text-muted-foreground hover:border-border hover:text-foreground'
                              )}
                            >
                              <GraduationCap className="size-3" />
                              Grade {grade}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
                <button
                  onClick={() => {
                    setSelectedPhase(null);
                    setSelectedGrade(null);
                    setSelectedSubject(null);
                    setPhaseOpen(false);
                  }}
                  className="w-full px-3 py-2 text-xs text-muted-foreground/50 hover:text-foreground/70 border-t border-border/30 transition-colors"
                >
                  Clear selection
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Subject dropdown (secondary access) — with reset button */}
        <div className="flex-1 relative flex items-center gap-2">
          <div className="flex-1 relative" ref={subjectDropdownRef}>
            <button
              onClick={() => { setSubjectOpen(!subjectOpen); setPhaseOpen(false); }}
              disabled={!selectedPhase}
              className={cn(
                'w-full h-10 px-4 rounded-xl border text-sm text-left flex items-center gap-2 transition-all',
                !selectedPhase && 'opacity-40 cursor-not-allowed',
                selectedSubject
                  ? 'border-primary/30 bg-primary/5 text-primary'
                  : 'border-border/50 bg-card text-muted-foreground hover:border-border'
              )}
            >
              <BookOpen className="size-3.5 shrink-0" />
              <span className="flex-1 truncate">
                {selectedSubject || 'All Subjects'}
              </span>
              <svg className="size-3.5 shrink-0 opacity-50" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 9 6 6 6-6"/></svg>
            </button>

            <AnimatePresence>
              {subjectOpen && selectedPhase && (
                <motion.div
                  initial={{ opacity: 0, y: -4, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -4, scale: 0.97 }}
                  transition={{ duration: 0.12 }}
                  className="absolute top-full mt-1 left-0 right-0 z-50 bg-card border border-border/50 rounded-xl shadow-lg overflow-hidden max-h-64 overflow-y-auto"
                >
                  {allPhaseSubjects.map((subject) => (
                    <button
                      key={subject.id}
                      onClick={() => {
                        selectSubject(subject.name);
                        setSubjectOpen(false);
                      }}
                      className={cn(
                        'w-full px-3 py-2 text-sm text-left hover:bg-muted/40 transition-colors flex items-center gap-2',
                        selectedSubject === subject.name && 'bg-primary/5 text-primary'
                      )}
                    >
                      <BookOpen className="size-3.5 text-muted-foreground/40" />
                      {subject.name}
                    </button>
                  ))}
                  {selectedSubject && (
                    <button
                      onClick={() => {
                        setSelectedSubject(null);
                        setSubjectOpen(false);
                      }}
                      className="w-full px-3 py-2 text-xs text-muted-foreground/50 hover:text-foreground/70 border-t border-border/30 transition-colors"
                    >
                      Clear subject filter
                    </button>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Reset / clear-filters button */}
          {(selectedPhase || selectedSubject || searchQuery || sortMode !== 'popular') && (
            <button
              onClick={() => {
                setSelectedPhase(null);
                setSelectedGrade(null);
                setSelectedSubject(null);
                setSearchQuery('');
                setSortMode('popular');
                onFilterChange?.(null);
              }}
              className="shrink-0 h-10 px-4 rounded-xl border border-border/50 bg-card text-sm text-muted-foreground hover:text-foreground hover:border-border transition-all flex items-center gap-1.5"
              title="Reset all filters"
            >
              <svg className="size-3.5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
              Reset
            </button>
          )}
        </div>
      </div>

    </div>
  );
}
