import type { DictationMode, GradeNorms } from "./dictation";

export type QuestionType = "multiple_choice" | "multiple_select" | "true_false" | "short_answer" | "matching" | "ordering" | WrittenType;

// Written works the teacher sets by hand, without AI: a dictation (also a word
// dictation or copying) checked against correct_answer, and an essay the teacher scores.
export type WrittenType = "dictation" | "essay";

// Levels of thinking (Bloom), as used in Kazakhstan's summative assessment tables.
export type BloomLevel = "knowledge" | "understanding" | "application" | "higher";

export type Question = {
  id: string;
  type: QuestionType;
  question: string;
  options?: string[];
  pairs?: { left: string; right: string }[];
  // Ordering: the items in their correct order (students get them shuffled).
  items?: string[];
  // Single-answer types use correct_answer; multiple_select uses correct_answers
  // and keeps correct_answer empty.
  correct_answer: string;
  correct_answers?: string[];
  explanation: string;
  skill_tag: string;
  source_reference?: string;
  bloom_level?: BloomLevel;
  dictation_mode?: DictationMode;
  // Mistakes allowed per grade; the mode's school norms when missing.
  grade_norms?: GradeNorms;
  // Essay: what the teacher scores and the most points for each.
  criteria?: EssayCriterion[];
  min_words?: number;
};

export type EssayCriterion = { name: string; points: number };

/** One row of a СОР/СОЧ table: what a task checks and how it is scored. */
export type RubricRow = { task: number; criterion: string; descriptor: string; points: number };

export type Assessment = {
  // СОР: summative assessment for a unit; СОЧ: for a term.
  kind: "sor" | "soch";
  rows: RubricRow[];
};

export type TestSource = {
  label: string;
  pages?: string;
  url?: string;
};

export type TestVariant = {
  title: string;
  instructions: string;
  questions: Question[];
  // Stored in the variant JSON so existing database rows remain compatible.
  sources?: TestSource[];
  // The teacher's material, kept so a replaced question stays on it. Never sent to students.
  source_text?: string;
  assessment?: Assessment;
};

export type ShareSettings = {
  allowed_students: string[];
  deadline_at: string | null;
  timer_minutes: number;
  one_question_at_a_time: boolean;
  randomize: boolean;
  reveal_score: boolean;
  // After submitting, show each question with the student's answer, the right
  // answer and the explanation.
  reveal_answers: boolean;
  // Strict mode: hide questions when the page loses focus, block copy/paste,
  // auto-submit after more than `leave_limit` leaves (null = never) and give
  // each question `question_seconds` (0 = no per-question limit).
  strict_mode: boolean;
  leave_limit: number | null;
  question_seconds: number;
  // Strict mode only: the test is shown in full screen where the browser
  // supports it, and leaving full screen counts as a leave.
  require_fullscreen: boolean;
};

export type ClassRow = {
  id: string;
  name: string;
  is_active: boolean;
  created_at: string;
  // name: the student's profile name once they have signed in.
  web_class_members: { id: string; email: string; full_name?: string | null; student_id: string | null; created_at: string; name?: string | null }[];
};

export type TestRow = {
  id: string;
  owner_id: string;
  title: string;
  topic: string;
  language: string;
  grade_level: string;
  status: "draft" | "published" | "archived";
  variants: Record<string, TestVariant>;
  created_at: string;
};
