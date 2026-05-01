-- HOTFIX: Add missing user_id column to flashcard_branch_cards
-- This is required for V9 hierarchy and deduplication logic.

DO $$ 
BEGIN
    -- 1. Add user_id column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name='flashcard_branch_cards' AND column_name='user_id'
    ) THEN
        ALTER TABLE public.flashcard_branch_cards ADD COLUMN user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
    END IF;

    -- 2. Backfill user_id from the parent branch's owner
    UPDATE public.flashcard_branch_cards fbc
    SET user_id = fb.user_id
    FROM public.flashcard_branches fb
    WHERE fbc.branch_id = fb.id
    AND fbc.user_id IS NULL;

    -- 3. Add unique constraint (deduplication)
    -- First, remove old duplicates if they exist to prevent constraint failure
    DELETE FROM public.flashcard_branch_cards
    WHERE id IN (
        SELECT id
        FROM (
            SELECT id,
                   ROW_NUMBER() OVER (PARTITION BY user_id, card_id ORDER BY created_at DESC) as row_num
            FROM public.flashcard_branch_cards
        ) t
        WHERE t.row_num > 1
    );

    ALTER TABLE public.flashcard_branch_cards DROP CONSTRAINT IF EXISTS flashcard_branch_cards_user_id_card_id_key;
    ALTER TABLE public.flashcard_branch_cards ADD CONSTRAINT flashcard_branch_cards_user_id_card_id_key UNIQUE (user_id, card_id);

END $$;
