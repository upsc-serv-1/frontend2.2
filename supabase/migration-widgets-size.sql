-- Allow per-user widget size override (half-tile vs full-row)
ALTER TABLE public.user_widgets
  ADD COLUMN IF NOT EXISTS size text NOT NULL DEFAULT 'half'
  CHECK (size IN ('half','full'));
