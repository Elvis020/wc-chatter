alter table public.rooms
  add column if not exists current_home_score integer,
  add column if not exists current_away_score integer,
  add column if not exists score_status text not null default 'unknown',
  add column if not exists score_clock text,
  add column if not exists score_provider text,
  add column if not exists score_updated_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'rooms_score_status_check'
    and conrelid = 'public.rooms'::regclass
  ) then
    alter table public.rooms
      add constraint rooms_score_status_check
      check (score_status in ('scheduled', 'live', 'finished', 'unknown'));
  end if;
end $$;

create index if not exists rooms_score_status_idx on public.rooms(score_status);
create index if not exists rooms_score_updated_at_idx on public.rooms(score_updated_at);

grant select, insert, update, delete on public.rooms to service_role;

notify pgrst, 'reload schema';
