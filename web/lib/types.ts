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
};

export type TestVariant = {
  title: string;
  instructions: string;
  questions: Question[];
};

export type ShareSettings = {
  allowed_students: string[];
  deadline_at: string | null;
  timer_minutes: number;
  one_question_at_a_time: boolean;
  randomize: boolean;
  reveal_score: boolean;
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
