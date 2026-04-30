-- 1) Branch nodes (user-specific hierarchy)
create table if not exists public.flashcard_branches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  parent_id uuid null references public.flashcard_branches(id) on delete cascade,
  name text not null,
  is_archived boolean not null default false,
  is_deleted boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- unique branch name under same parent (active branches only)
create unique index if not exists ux_flashcard_branches_user_parent_name
on public.flashcard_branches (
  user_id,
  coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid),
  lower(name)
)
where is_deleted = false;

create index if not exists idx_flashcard_branches_user_parent
on public.flashcard_branches(user_id, parent_id);

-- 2) user-specific card assignment to leaf branch
create table if not exists public.flashcard_branch_cards (
  user_id uuid not null references auth.users(id) on delete cascade,
  branch_id uuid not null references public.flashcard_branches(id) on delete cascade,
  card_id uuid not null references public.cards(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, card_id)
);

create index if not exists idx_flashcard_branch_cards_branch
on public.flashcard_branch_cards(user_id, branch_id);

-- RLS
alter table public.flashcard_branches enable row level security;
alter table public.flashcard_branch_cards enable row level security;

create policy "Users can manage their own branches"
on public.flashcard_branches for all
using (auth.uid() = user_id);

create policy "Users can manage their own branch card mappings"
on public.flashcard_branch_cards for all
using (auth.uid() = user_id);
