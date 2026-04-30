-- ============================================================
-- Migration: Upgrade Schema to Website Standard (V2)
-- Run this in Supabase SQL Editor to support rich data
-- ============================================================

-- 1. Enhance QUESTIONS table with rich metadata
ALTER TABLE questions 
ADD COLUMN IF NOT EXISTS statement_lines jsonb DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS question_blocks jsonb DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS subject text,
ADD COLUMN IF NOT EXISTS section_group text,
ADD COLUMN IF NOT EXISTS micro_topic text,
ADD COLUMN IF NOT EXISTS source_attribution_label text,
ADD COLUMN IF NOT EXISTS exam_info jsonb DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS source jsonb DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS test_id uuid; -- To group questions by test source

-- 2. Enhance TESTS table with website metadata
ALTER TABLE tests
ADD COLUMN IF NOT EXISTS provider text,
ADD COLUMN IF NOT EXISTS institute text,
ADD COLUMN IF NOT EXISTS program_id text,
ADD COLUMN IF NOT EXISTS program_name text,
ADD COLUMN IF NOT EXISTS launch_year int,
ADD COLUMN IF NOT EXISTS series text,
ADD COLUMN IF NOT EXISTS level text,
ADD COLUMN IF NOT EXISTS year int,
ADD COLUMN IF NOT EXISTS subject text,
ADD COLUMN IF NOT EXISTS subject_test text,
ADD COLUMN IF NOT EXISTS section_group text,
ADD COLUMN IF NOT EXISTS paper_type text,
ADD COLUMN IF NOT EXISTS question_count int DEFAULT 0,
ADD COLUMN IF NOT EXISTS default_minutes int,
ADD COLUMN IF NOT EXISTS source_mode text,
ADD COLUMN IF NOT EXISTS is_demo_available boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- 3. Add foreign key if not exists (linking questions to tests directly)
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'questions_test_id_fkey') THEN
    ALTER TABLE questions ADD CONSTRAINT questions_test_id_fkey FOREIGN KEY (test_id) REFERENCES tests(id) ON DELETE CASCADE;
  END IF;
END $$;

-- 4. Create optimized indexes for the mobile app
CREATE INDEX IF NOT EXISTS idx_questions_subject ON questions(subject);
CREATE INDEX IF NOT EXISTS idx_questions_section ON questions(section_group);
CREATE INDEX IF NOT EXISTS idx_questions_micro ON questions(micro_topic);
CREATE INDEX IF NOT EXISTS idx_questions_test_id ON questions(test_id);
CREATE INDEX IF NOT EXISTS idx_tests_program ON tests(program_id);

-- 5. Create a view for easy filtering (optional but helpful)
CREATE OR REPLACE VIEW question_bank AS
SELECT 
  q.id,
  q.subject,
  q.section_group,
  q.micro_topic,
  q.is_pyq,
  q.year as exam_year,
  t.title as test_source,
  q.question_text
FROM questions q
LEFT JOIN tests t ON q.test_id = t.id;
