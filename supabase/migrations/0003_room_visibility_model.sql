alter table public.rooms
  add column if not exists match_status text not null default 'upcoming',
  add column if not exists room_status text not null default 'open',
  add column if not exists is_featured boolean not null default false;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'rooms_match_status_check'
    and conrelid = 'public.rooms'::regclass
  ) then
    alter table public.rooms
      add constraint rooms_match_status_check
      check (match_status in ('upcoming', 'live', 'finished'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'rooms_room_status_check'
    and conrelid = 'public.rooms'::regclass
  ) then
    alter table public.rooms
      add constraint rooms_room_status_check
      check (room_status in ('open', 'closed', 'hidden'));
  end if;
end $$;

update public.rooms
set
  match_status = case
    when status = 'live' then 'live'
    when status in ('closed', 'archived') then 'finished'
    else 'upcoming'
  end,
  room_status = case
    when status = 'archived' then 'closed'
    when status = 'closed' then 'closed'
    else 'open'
  end
where match_status = 'upcoming'
  and room_status = 'open';

with ranked_live_rooms as (
  select id, row_number() over (order by created_at desc) as rank
  from public.rooms
  where match_status = 'live'
)
update public.rooms
set is_featured = ranked_live_rooms.rank = 1
from ranked_live_rooms
where public.rooms.id = ranked_live_rooms.id;

create index if not exists rooms_match_status_idx on public.rooms(match_status);
create index if not exists rooms_room_status_idx on public.rooms(room_status);
create unique index if not exists rooms_one_featured_idx on public.rooms(is_featured) where is_featured;

grant select, insert, update, delete on public.rooms to service_role;

notify pgrst, 'reload schema';
