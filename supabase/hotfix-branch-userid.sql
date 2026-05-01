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

    -- 4. Add question_id to user_cards if missing
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name='user_cards' AND column_name='question_id'
    ) THEN
        ALTER TABLE public.user_cards ADD COLUMN question_id UUID;
    END IF;

    -- 5. Backfill question_id from cards table
    UPDATE public.user_cards uc
    SET question_id = c.question_id::uuid
    FROM public.cards c
    WHERE uc.card_id = c.id
    AND uc.question_id IS NULL
    AND c.question_id IS NOT NULL
    AND c.question_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';

    -- 6. Add question_id to cards table if missing
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name='cards' AND column_name='question_id'
    ) THEN
        ALTER TABLE public.cards ADD COLUMN question_id UUID;
    END IF;

END $$;
