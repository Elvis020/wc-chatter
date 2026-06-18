create extension if not exists pgcrypto;

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  title text not null,
  home_name text not null,
  home_code text not null,
  home_iso2 text not null default '',
  home_flag text not null default '',
  away_name text not null,
  away_code text not null,
  away_iso2 text not null default '',
  away_flag text not null default '',
  event_date date,
  status text not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rooms_status_check check (status in ('draft', 'live', 'closed', 'archived'))
);

create table if not exists public.predictions (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  author_id text not null,
  author_name text not null,
  home_score integer not null,
  away_score integer not null,
  take text,
  created_at timestamptz not null default now(),
  constraint predictions_score_check check (
    home_score >= 0 and home_score <= 99 and away_score >= 0 and away_score <= 99
  ),
  constraint predictions_author_name_check check (char_length(author_name) between 2 and 24),
  constraint predictions_take_check check (take is null or char_length(take) <= 280),
  constraint predictions_room_author_unique unique (room_id, author_id)
);

create table if not exists public.prediction_likes (
  prediction_id uuid not null references public.predictions(id) on delete cascade,
  user_id text not null,
  created_at timestamptz not null default now(),
  primary key (prediction_id, user_id)
);

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  prediction_id uuid not null references public.predictions(id) on delete cascade,
  author_id text not null,
  author_name text not null,
  text text not null,
  hidden boolean not null default false,
  created_at timestamptz not null default now(),
  constraint comments_author_name_check check (char_length(author_name) between 2 and 24),
  constraint comments_text_check check (char_length(text) between 1 and 280)
);

create table if not exists public.comment_replies (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references public.comments(id) on delete cascade,
  author_id text not null,
  author_name text not null,
  text text not null,
  hidden boolean not null default false,
  created_at timestamptz not null default now(),
  constraint comment_replies_author_name_check check (char_length(author_name) between 2 and 24),
  constraint comment_replies_text_check check (char_length(text) between 1 and 280)
);

create index if not exists rooms_status_idx on public.rooms(status);
create index if not exists predictions_room_created_idx on public.predictions(room_id, created_at desc);
create index if not exists prediction_likes_prediction_idx on public.prediction_likes(prediction_id);
create index if not exists comments_prediction_created_idx on public.comments(prediction_id, created_at);
create index if not exists comment_replies_comment_created_idx on public.comment_replies(comment_id, created_at);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists rooms_set_updated_at on public.rooms;
create trigger rooms_set_updated_at
before update on public.rooms
for each row
execute function public.set_updated_at();
