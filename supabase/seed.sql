insert into public.rooms (
  slug,
  title,
  home_name,
  home_code,
  home_iso2,
  home_flag,
  away_name,
  away_code,
  away_iso2,
  away_flag,
  event_date,
  status
) values
  ('ghana-england-2026', 'Ghana vs England', 'Ghana', 'GHA', 'GH', '🇬🇭', 'England', 'ENG', 'GB-ENG', '🏴', current_date, 'live'),
  ('ghana-brazil-2026', 'Ghana vs Brazil', 'Ghana', 'GHA', 'GH', '🇬🇭', 'Brazil', 'BRA', 'BR', '🇧🇷', current_date + 1, 'draft'),
  ('nigeria-argentina-2026', 'Nigeria vs Argentina', 'Nigeria', 'NGA', 'NG', '🇳🇬', 'Argentina', 'ARG', 'AR', '🇦🇷', current_date + 1, 'draft'),
  ('spain-france-2026', 'Spain vs France', 'Spain', 'ESP', 'ES', '🇪🇸', 'France', 'FRA', 'FR', '🇫🇷', current_date + 2, 'draft')
on conflict (slug) do update set
  title = excluded.title,
  home_name = excluded.home_name,
  home_code = excluded.home_code,
  home_iso2 = excluded.home_iso2,
  home_flag = excluded.home_flag,
  away_name = excluded.away_name,
  away_code = excluded.away_code,
  away_iso2 = excluded.away_iso2,
  away_flag = excluded.away_flag,
  event_date = excluded.event_date,
  status = excluded.status;

with room as (
  select id from public.rooms where slug = 'ghana-england-2026'
), inserted_predictions as (
  insert into public.predictions (room_id, author_id, author_name, home_score, away_score, take, created_at)
  select room.id, seed.author_id, seed.author_name, seed.home_score, seed.away_score, seed.take, now() - seed.age
  from room
  cross join (
    values
      ('seed-kojo', 'Kojo', 2, 1, 'This room will get loud early.', interval '42 minutes'),
      ('seed-ama', 'Ama', 1, 1, 'I trust the midfield more than the headlines.', interval '31 minutes'),
      ('seed-nadia', 'Nadia', 2, 0, 'This score feels brave enough to post.', interval '18 minutes')
  ) as seed(author_id, author_name, home_score, away_score, take, age)
  on conflict (room_id, author_id) do update set
    author_name = excluded.author_name,
    home_score = excluded.home_score,
    away_score = excluded.away_score,
    take = excluded.take
  returning id, author_id, author_name, take
)
insert into public.comments (prediction_id, author_id, author_name, text)
select id, author_id, author_name, take
from inserted_predictions
where take is not null
on conflict do nothing;
