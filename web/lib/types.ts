export type QuestionType = "multiple_choice" | "true_false" | "short_answer" | "matching";

export type Question = {
  id: string;
  type: QuestionType;
  question: string;
  options?: string[];
  pairs?: { left: string; right: string }[];
  correct_answer: string;
  explanation: string;
  skill_tag: string;
  source_reference?: string;
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
};

export type ShareSettings = {
  allowed_students: string[];
  deadline_at: string | null;
  timer_minutes: number;
  one_question_at_a_time: boolean;
  randomize: boolean;
  reveal_score: boolean;
  // Strict mode: hide questions when the page loses focus, block copy/paste,
  // auto-submit after more than `leave_limit` leaves (null = never) and give
  // each question `question_seconds` (0 = no per-question limit).
  strict_mode: boolean;
  leave_limit: number | null;
  question_seconds: number;
};

export type ClassRow = {
  id: string;
  name: string;
  is_active: boolean;
  created_at: string;
  web_class_members: { id: string; email: string; student_id: string | null; created_at: string }[];
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
