-- PATCH 01: multi-institute answer tracking + local-sync fields
alter table public.cards
  add column if not exists institutes jsonb default '[]'::jsonb,
  add column if not exists merged_from jsonb default '[]'::jsonb,
  add column if not exists primary_institute text;

alter table public.user_cards
  add column if not exists learning_status text default 'not_studied',
  add column if not exists user_note text default '',
  add column if not exists client_updated_at timestamptz default now(),
  add column if not exists dirty boolean default false,
  add column if not exists times_seen integer default 0;

create or replace view public.v_deck_summary as
select
  uc.user_id,
  c.subject,
  coalesce(c.section_group, 'General') as section_group,
  coalesce(c.microtopic, 'General') as microtopic,
  count(*) filter (where coalesce(uc.learning_status, 'not_studied') = 'not_studied') as new_count,
  count(*) filter (where coalesce(uc.learning_status, 'not_studied') in ('learning', 'review')) as learning_count,
  count(*) filter (where coalesce(uc.learning_status, 'not_studied') = 'mastered') as mastered_count,
  count(*) filter (where uc.status = 'active' and (uc.next_review is null or uc.next_review <= now())) as due_count,
  count(*) as total_count
from public.user_cards uc
join public.cards c on c.id = uc.card_id
group by uc.user_id, c.subject, c.section_group, c.microtopic;

alter view public.v_deck_summary set (security_invoker = true);

insert into storage.buckets (id, name, public)
values ('flashcard-images', 'flashcard-images', true)
on conflict (id) do nothing;

drop policy if exists "flashcard-images-read" on storage.objects;
drop policy if exists "flashcard-images-write" on storage.objects;
drop policy if exists "flashcard-images-delete" on storage.objects;

create policy "flashcard-images-read"
  on storage.objects for select
  using (bucket_id = 'flashcard-images');

create policy "flashcard-images-write"
  on storage.objects for insert
  with check (
    bucket_id = 'flashcard-images'
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "flashcard-images-delete"
  on storage.objects for delete
  using (
    bucket_id = 'flashcard-images'
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
