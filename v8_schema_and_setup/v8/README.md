# Supabase Setup - Flashcard Branches

To enable the new hierarchical flashcard system, you must run this SQL in your Supabase dashboard.

### 1. Open Supabase Dashboard
Go to your project at [supabase.com](https://supabase.com).

### 2. Open SQL Editor
Click on the **SQL Editor** icon in the left sidebar.

### 3. Create a New Query
Click **+ New Query** and paste the following code:

```sql
-- 1) Create Flashcard Branches table
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

-- 2) Create mapping table (which card is in which branch)
CREATE TABLE IF NOT EXISTS public.flashcard_branch_cards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    branch_id UUID NOT NULL REFERENCES public.flashcard_branches(id) ON DELETE CASCADE,
    card_id UUID NOT NULL REFERENCES public.cards(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(branch_id, card_id)
);

-- 3) Enable RLS
ALTER TABLE public.flashcard_branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.flashcard_branch_cards ENABLE ROW LEVEL SECURITY;

-- 4) Create RLS Policies
CREATE POLICY "Users can manage their own branches"
ON public.flashcard_branches
FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can manage their branch card mappings"
ON public.flashcard_branch_cards
FOR ALL
USING (
    EXISTS (
        SELECT 1 FROM public.flashcard_branches
        WHERE id = branch_id AND user_id = auth.uid()
    )
);

-- 5) Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_flashcard_branches_user ON public.flashcard_branches(user_id);
CREATE INDEX IF NOT EXISTS idx_flashcard_branches_parent ON public.flashcard_branches(parent_id);
CREATE INDEX IF NOT EXISTS idx_flashcard_branch_cards_branch ON public.flashcard_branch_cards(branch_id);
CREATE INDEX IF NOT EXISTS idx_flashcard_branch_cards_card ON public.flashcard_branch_cards(card_id);
```

### 4. Click Run
Click the **Run** button. You should see "Success".

---

### Why this is stable:
1. **Referential Integrity**: Cards and branches are linked. If you delete a branch, the mappings are cleaned up automatically.
2. **User Isolation**: Your branches are only visible to you.
3. **Automatic Organization**: The app will now automatically create "Subject > Section > Microtopic" folders for you whenever you add a card.
4. **Cross-device Sync**: Since this is in Supabase, your custom hierarchy will be identical on your phone, tablet, and web.
