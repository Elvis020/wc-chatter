alter table public.predictions
  add column if not exists edited_at timestamptz;

alter table public.comments
  add column if not exists edited_at timestamptz;

alter table public.comment_replies
  add column if not exists edited_at timestamptz;

notify pgrst, 'reload schema';
