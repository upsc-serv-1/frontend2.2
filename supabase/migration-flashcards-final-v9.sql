-- FLASHCARDS ENGINE V9 CONSOLIDATED BACKUP
-- Includes: Strict Schema, SRS Logic, Hierarchy Triggers, and Recursive Repair functions.

-- 1. ENUMS AND TYPE CONSTRAINTS
-- Ensure strict state management at the database level.
DO $$ 
BEGIN
    -- Add CHECK constraints for Card Lifecycle Status
    ALTER TABLE user_cards DROP CONSTRAINT IF EXISTS check_card_status;
    ALTER TABLE user_cards ADD CONSTRAINT check_card_status 
        CHECK (status IN ('active', 'frozen', 'deleted'));

    -- Add CHECK constraints for SRS Learning Status
    ALTER TABLE user_cards DROP CONSTRAINT IF EXISTS check_learning_status;
    ALTER TABLE user_cards ADD CONSTRAINT check_learning_status 
        CHECK (learning_status IN ('not_studied', 'learning', 'mastered'));
END $$;

-- 2. SCHEMA HARDENING
ALTER TABLE user_cards ALTER COLUMN status SET DEFAULT 'active';
ALTER TABLE user_cards ALTER COLUMN learning_status SET DEFAULT 'not_studied';
ALTER TABLE user_cards ALTER COLUMN repetitions SET DEFAULT 0;
ALTER TABLE user_cards ALTER COLUMN interval_days SET DEFAULT 0;
ALTER TABLE user_cards ALTER COLUMN ease_factor SET DEFAULT 2.5;

-- 3. HIERARCHY ENGINE
-- This table stores the recursive folder structure.
CREATE TABLE IF NOT EXISTS flashcard_branches (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    parent_id UUID REFERENCES flashcard_branches(id) ON DELETE CASCADE,
    level INTEGER DEFAULT 0,
    is_deleted BOOLEAN DEFAULT false,
    is_archived BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Junction table for many-to-many relationship (card can be in one branch per user)
CREATE TABLE IF NOT EXISTS flashcard_branch_cards (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    branch_id UUID REFERENCES flashcard_branches(id) ON DELETE CASCADE,
    card_id UUID REFERENCES cards(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, card_id) -- Ensures a card is only in one folder per user
);

-- 4. RECURSIVE REPAIR LOGIC
-- Function to find or create a branch path (Subject > Section > Topic)
CREATE OR REPLACE FUNCTION get_or_create_branch_path(
    p_user_id UUID,
    p_subject TEXT,
    p_section TEXT,
    p_microtopic TEXT
) RETURNS UUID AS $$
DECLARE
    v_sub_id UUID;
    v_sec_id UUID;
    v_mic_id UUID;
BEGIN
    -- 1. Subject Level
    SELECT id INTO v_sub_id FROM flashcard_branches 
    WHERE user_id = p_user_id AND name = p_subject AND parent_id IS NULL;
    IF v_sub_id IS NULL THEN
        INSERT INTO flashcard_branches (user_id, name, level) 
        VALUES (p_user_id, p_subject, 0) RETURNING id INTO v_sub_id;
    END IF;

    -- 2. Section Level
    SELECT id INTO v_sec_id FROM flashcard_branches 
    WHERE user_id = p_user_id AND name = p_section AND parent_id = v_sub_id;
    IF v_sec_id IS NULL THEN
        INSERT INTO flashcard_branches (user_id, name, parent_id, level) 
        VALUES (p_user_id, p_section, v_sub_id, 1) RETURNING id INTO v_sec_id;
    END IF;

    -- 3. Microtopic Level
    SELECT id INTO v_mic_id FROM flashcard_branches 
    WHERE user_id = p_user_id AND name = p_microtopic AND parent_id = v_sec_id;
    IF v_mic_id IS NULL THEN
        INSERT INTO flashcard_branches (user_id, name, parent_id, level) 
        VALUES (p_user_id, p_microtopic, v_sec_id, 2) RETURNING id INTO v_mic_id;
    END IF;

    RETURN v_mic_id;
END;
$$ LANGUAGE plpgsql;

-- 5. DATA CLEANUP (CONVERT LEGACY 'new' STATUS)
UPDATE user_cards 
SET learning_status = 'not_studied', status = 'active' 
WHERE status = 'new';

-- 6. FRONTEND RECAP (V9)
-- - Dashboard: FlatList with recursive flatten logic.
-- - Tally: Real-time sum of card counts from children nodes.
-- - Sync: Pull-to-refresh triggers syncHierarchy repair engine.
-- - UX: Vertical lines (zIndex: 1) and Plus/Minus icons.
-- - Safety: Cloned cards automatically repoint branch mappings.
