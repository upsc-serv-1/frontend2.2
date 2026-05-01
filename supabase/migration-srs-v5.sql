-- SRS engine v5: minimal additive columns
ALTER TABLE public.user_cards
  ADD COLUMN IF NOT EXISTS learning_step    smallint,
  ADD COLUMN IF NOT EXISTS interval_minutes integer NOT NULL DEFAULT 0;

ALTER TABLE public.card_reviews
  ADD COLUMN IF NOT EXISTS rating        text,
  ADD COLUMN IF NOT EXISTS learning_step smallint,
  ADD COLUMN IF NOT EXISTS prev_minutes  integer,
  ADD COLUMN IF NOT EXISTS new_minutes   integer;
