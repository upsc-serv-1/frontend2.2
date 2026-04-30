-- V8 FULL SCHEMA BACKUP - Flashcard Branches
-- Date: 2026-05-01

-- 1. Flashcard Branches Table
CREATE TABLE IF NOT EXISTS public.flashcard_branches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    parent_id UUID REFERENCES public.flashcard_branches(id) ON DELETE CASCADE,
    is_archived BOOLEAN DEFAULT false,
    is_deleted BOOLEAN DEFAULT false,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Flashcard Branch Cards Mapping Table
CREATE TABLE IF NOT EXISTS public.flashcard_branch_cards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    branch_id UUID NOT NULL REFERENCES public.flashcard_branches(id) ON DELETE CASCADE,
    card_id UUID NOT NULL REFERENCES public.cards(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(branch_id, card_id)
);

-- 3. Security (RLS)
ALTER TABLE public.flashcard_branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.flashcard_branch_cards ENABLE ROW LEVEL SECURITY;

-- 4. Policies
DROP POLICY IF EXISTS "Users can manage their own branches" ON public.flashcard_branches;
CREATE POLICY "Users can manage their own branches"
ON public.flashcard_branches
FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can manage their branch card mappings" ON public.flashcard_branch_cards;
CREATE POLICY "Users can manage their branch card mappings"
ON public.flashcard_branch_cards
FOR ALL
USING (
    EXISTS (
        SELECT 1 FROM public.flashcard_branches
        WHERE id = branch_id AND user_id = auth.uid()
    )
);

-- 5. Performance Indexes
CREATE INDEX IF NOT EXISTS idx_flashcard_branches_user ON public.flashcard_branches(user_id);
CREATE INDEX IF NOT EXISTS idx_flashcard_branches_parent ON public.flashcard_branches(parent_id);
CREATE INDEX IF NOT EXISTS idx_flashcard_branch_cards_branch ON public.flashcard_branch_cards(branch_id);
CREATE INDEX IF NOT EXISTS idx_flashcard_branch_cards_card ON public.flashcard_branch_cards(card_id);
