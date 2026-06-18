# Task 02: Database Schema

## Goal

Create the Supabase Postgres schema for rooms, predictions, likes, comments, and replies.

## Core Tables

### `rooms`

Fields:

- `id uuid primary key`
- `slug text unique not null`
- `title text not null`
- `home_name text not null`
- `home_code text not null`
- `home_flag text not null`
- `away_name text not null`
- `away_code text not null`
- `away_flag text not null`
- `event_date date`
- `status text not null` with values: `draft`, `live`, `closed`, `archived`
- `created_at timestamptz default now()`
- `updated_at timestamptz default now()`

### `predictions`

Fields:

- `id uuid primary key`
- `room_id uuid not null references rooms(id)`
- `author_id text not null`
- `author_name text not null`
- `home_score int not null`
- `away_score int not null`
- `take text`
- `created_at timestamptz default now()`
- unique constraint on `(room_id, author_id)`

### `prediction_likes`

Fields:

- `prediction_id uuid not null references predictions(id) on delete cascade`
- `user_id text not null`
- `created_at timestamptz default now()`
- primary key `(prediction_id, user_id)`

### `comments`

Fields:

- `id uuid primary key`
- `prediction_id uuid not null references predictions(id) on delete cascade`
- `author_id text not null`
- `author_name text not null`
- `text text not null`
- `hidden boolean default false`
- `created_at timestamptz default now()`

### `comment_replies`

Fields:

- `id uuid primary key`
- `comment_id uuid not null references comments(id) on delete cascade`
- `author_id text not null`
- `author_name text not null`
- `text text not null`
- `hidden boolean default false`
- `created_at timestamptz default now()`

## Indexes

Add indexes for:

- `rooms(status)`
- `predictions(room_id, created_at desc)`
- `prediction_likes(prediction_id)`
- `comments(prediction_id, created_at)`
- `comment_replies(comment_id, created_at)`

## Seed Data

Seed four rooms:

- Ghana vs England, live
- Ghana vs Brazil, archived/open
- Nigeria vs Argentina, open
- Spain vs France, open

Seed a few predictions and comments matching the prototype enough for frontend development.

## Security

For v1, the backend should use the Supabase service role key. Do not expose the service role key to the frontend.

Frontend may receive the anon key only if needed, but the preferred v1 path is:

```text
Frontend -> Backend API -> Supabase
```

## Acceptance Criteria

- Migration SQL is committed.
- Seed SQL is committed.
- A clean Supabase project can be initialized from migrations and seed data by the project owner.
- Constraints prevent duplicate predictions per user per room.
- Constraints prevent duplicate likes per user per prediction.

## Out Of Scope

- Creating the Supabase project.
- Managing Supabase billing/organization settings.
- Managing production Supabase secrets.
