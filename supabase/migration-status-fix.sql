-- Fix for 'again and again' logic and missing cards
-- Restores 'status' to 'active' if it was incorrectly set to SRS states or 'new'
-- Moves SRS states to the 'learning_status' column

-- 1. If status is an SRS state, move it to learning_status and reset status to 'active'
UPDATE public.user_cards
SET 
  learning_status = status,
  status = 'active'
WHERE status IN ('learning', 'review', 'mastered', 'leech');

-- 2. If status is 'new', reset to 'active' and ensure learning_status is 'not_studied'
UPDATE public.user_cards
SET 
  status = 'active',
  learning_status = 'not_studied'
WHERE status = 'new';
