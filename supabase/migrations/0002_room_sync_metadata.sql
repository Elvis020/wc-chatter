alter table public.rooms
  add column if not exists kickoff_at timestamptz,
  add column if not exists round text,
  add column if not exists group_name text,
  add column if not exists venue text,
  add column if not exists source text not null default 'manual',
  add column if not exists source_match_id text;

create index if not exists rooms_kickoff_at_idx on public.rooms(kickoff_at);
create index if not exists rooms_source_match_id_idx on public.rooms(source_match_id);

grant usage on schema public to anon, authenticated, service_role;

grant select, insert, update, delete on public.rooms to service_role;
grant select, insert, update, delete on public.predictions to service_role;
grant select, insert, update, delete on public.prediction_likes to service_role;
grant select, insert, update, delete on public.comments to service_role;
grant select, insert, update, delete on public.comment_replies to service_role;

notify pgrst, 'reload schema';
