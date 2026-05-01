-- SCHEMA HARDENING V6
-- 1. Ensure learning_status column exists
ALTER TABLE public.user_cards ADD COLUMN IF NOT EXISTS learning_status text DEFAULT 'not_studied';

-- 2. Migrate existing data (Clean up)
UPDATE public.user_cards
SET 
  learning_status = CASE 
    WHEN status IN ('learning', 'review', 'mastered', 'leech') THEN status
    ELSE 'not_studied'
  END,
  status = CASE 
    WHEN status IN ('learning', 'review', 'mastered', 'leech', 'new') THEN 'active'
    WHEN status = 'frozen' THEN 'frozen'
    WHEN status = 'deleted' THEN 'deleted'
    ELSE 'active'
  END;

-- 3. Add Constraints to prevent future "garbage" data
-- First, remove any old check constraints if they exist (optional, depends on previous state)
-- ALTER TABLE public.user_cards DROP CONSTRAINT IF EXISTS user_cards_status_check;
-- ALTER TABLE public.user_cards DROP CONSTRAINT IF EXISTS user_cards_learning_status_check;

ALTER TABLE public.user_cards 
  ADD CONSTRAINT user_cards_status_check 
  CHECK (status IN ('active', 'frozen', 'deleted'));

ALTER TABLE public.user_cards 
  ADD CONSTRAINT user_cards_learning_status_check 
  CHECK (learning_status IN ('not_studied', 'learning', 'review', 'mastered', 'leech'));

-- 4. Set Defaults and NOT NULL
ALTER TABLE public.user_cards ALTER COLUMN status SET NOT NULL;
ALTER TABLE public.user_cards ALTER COLUMN status SET DEFAULT 'active';
ALTER TABLE public.user_cards ALTER COLUMN learning_status SET NOT NULL;
ALTER TABLE public.user_cards ALTER COLUMN learning_status SET DEFAULT 'not_studied';

-- 5. Hardening for flashcard_branches
ALTER TABLE public.flashcard_branches 
  ADD CONSTRAINT flashcard_branches_name_check CHECK (length(trim(name)) > 0);
