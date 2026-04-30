-- 1. Create the flashcard_branches table
CREATE TABLE IF NOT EXISTS public.flashcard_branches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    parent_id UUID REFERENCES public.flashcard_branches(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    is_archived BOOLEAN DEFAULT false,
    is_deleted BOOLEAN DEFAULT false,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Create the flashcard_branch_cards junction table
CREATE TABLE IF NOT EXISTS public.flashcard_branch_cards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    branch_id UUID NOT NULL REFERENCES public.flashcard_branches(id) ON DELETE CASCADE,
    card_id UUID NOT NULL REFERENCES public.cards(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(branch_id, card_id)
);

-- 3. Enable RLS (Row Level Security)
ALTER TABLE public.flashcard_branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.flashcard_branch_cards ENABLE ROW LEVEL SECURITY;

-- 4. Create RLS Policies
CREATE POLICY "Users can manage their own branches" ON public.flashcard_branches
    FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users can manage their own branch card mappings" ON public.flashcard_branch_cards
    FOR ALL USING (auth.uid() = user_id);

-- 5. Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_flashcard_branches_user ON public.flashcard_branches(user_id);
CREATE INDEX IF NOT EXISTS idx_flashcard_branches_parent ON public.flashcard_branches(parent_id);
CREATE INDEX IF NOT EXISTS idx_flashcard_branch_cards_branch ON public.flashcard_branch_cards(branch_id);
CREATE INDEX IF NOT EXISTS idx_flashcard_branch_cards_card ON public.flashcard_branch_cards(card_id);

-- 6. Helper for existing tables that might be missing columns
ALTER TABLE public.flashcard_branches 
ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0;

ALTER TABLE public.flashcard_branches 
ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT false;

ALTER TABLE public.flashcard_branches 
ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT false;
