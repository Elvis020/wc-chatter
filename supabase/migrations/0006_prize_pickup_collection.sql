alter table public.prize_claims
  add column if not exists picked_up_at timestamptz;

create index if not exists prize_claims_picked_up_idx on public.prize_claims(picked_up_at);

grant select, insert, update, delete on public.prize_claims to service_role;

notify pgrst, 'reload schema';
