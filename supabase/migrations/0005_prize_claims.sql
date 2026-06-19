create table if not exists public.prize_claims (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  prediction_id uuid not null references public.predictions(id) on delete cascade,
  author_id text not null,
  author_name text not null,
  question text not null,
  answer text not null,
  created_at timestamptz not null default now(),
  constraint prize_claims_question_check check (char_length(question) between 4 and 280),
  constraint prize_claims_answer_check check (char_length(answer) between 2 and 280),
  constraint prize_claims_prediction_unique unique (prediction_id)
);

create index if not exists prize_claims_room_created_idx on public.prize_claims(room_id, created_at desc);

grant select, insert, update, delete on public.prize_claims to service_role;
