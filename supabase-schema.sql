-- ==========================================
-- 1. CLEANUP: DROP OLD TABLES
-- ==========================================
drop table if exists question_states cascade;
drop table if exists questions cascade;
drop table if exists test_attempts cascade;
drop table if exists tests cascade;
drop table if exists study_sessions cascade;
drop table if exists user_cards cascade;
drop table if exists user_notes cascade;
drop table if exists user_settings cascade;

-- ==========================================
-- 2. RECREATE TABLES (WEBSITE ALIGNMENT)
-- ==========================================

-- TESTS TABLE
create table tests (
  id text primary key,
  title text,
  provider text,
  institute text,
  program_id text,
  program_name text,
  launch_year integer,
  series text,
  level text,
  year integer,
  subject text,
  subject_test text,
  section_group text,
  paper_type text,
  question_count integer,
  default_minutes integer,
  source_mode text,
  is_demo_available boolean default false,
  exam_year integer,
  updated_at timestamptz default now()
);

-- QUESTIONS TABLE
create table questions (
  id text primary key,
  test_id text references tests(id) on delete cascade,
  question_number integer,
  question_text text not null,
  statement_lines jsonb,
  question_blocks jsonb,
  options jsonb not null,
  correct_answer text not null,
  explanation_markdown text,
  source_attribution_label text,
  source jsonb,
  subject text,
  section_group text,
  micro_topic text,
  is_pyq boolean default false,
  is_ncert boolean default false,
  is_upsc_cse boolean default false,
  is_allied boolean default false,
  is_others boolean default false,
  is_cancelled boolean default false,
  exam text,
  exam_group text,
  exam_year integer,
  exam_category text,
  specific_exam text,
  exam_stage text,
  exam_paper text,
  updated_at timestamptz default now()
);

-- QUESTION STATES TABLE
create table question_states (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  question_id text references questions(id) on delete cascade,
  test_id text references tests(id) on delete cascade,
  selected_answer text,
  confidence text,
  note text,
  highlight_text text,
  saved_folders jsonb,
  review_tags jsonb, -- JSONB for flexible tagging as per website
  question_type_tags jsonb,
  review_difficulty text,
  is_incorrect_last_attempt boolean default false,
  marked_tough boolean default false,
  marked_must_revise boolean default false,
  attempts_history jsonb,
  spaced_revision jsonb,
  updated_at timestamptz default now(),
  unique(user_id, question_id)
);

-- TEST ATTEMPTS TABLE
create table test_attempts (
  id text primary key,
  user_id uuid references auth.users(id) on delete cascade,
  test_id text references tests(id) on delete cascade,
  title text,
  provider text,
  subject text,
  explanation_mode text,
  timer_mode text,
  timer_minutes integer,
  started_at timestamptz default now(),
  submitted_at timestamptz,
  score numeric,
  attempt_payload jsonb
);

-- ==========================================
-- 3. INDICES FOR PERFORMANCE
-- ==========================================
create index idx_q_subject on questions(subject);
create index idx_q_section on questions(section_group);
create index idx_q_stage on questions(exam_stage);
create index idx_q_pyq_status on questions(is_pyq, is_upsc_cse, is_allied);
create index idx_qs_user on question_states(user_id);
create index idx_qs_revise on question_states(marked_must_revise) where marked_must_revise = true;
