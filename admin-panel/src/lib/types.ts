export type Question = {
  id: string;
  test_id?: string | null;
  question_text: string;
  options: Record<string, string>;
  correct_answer: string;
  explanation_markdown: string | null;
  subject: string | null;
  micro_topic: string | null;
  section_group: string | null;
  is_pyq: boolean | null;
  is_upsc_cse: boolean | null;
  is_allied: boolean | null;
  is_others: boolean | null;
  exam_year: number | null;
};

export type Test = {
  id: string;
  title: string;
  provider: string | null;
  institute: string | null;
  program_name: string | null;
  question_count: number | null;
  default_minutes: number | null;
  created_at?: string;
};

export type AdminUser = { id: string; user_id: string; email: string; role: string };

export type Performance = {
  attempt_id: string;
  user_id: string;
  test_id: string;
  test_title: string;
  score: number;
  question_count: number;
  accuracy_pct: number;
  started_at: string | null;
  submitted_at: string;
  duration_seconds: number;
};
