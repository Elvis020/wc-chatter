# Turntabl Score Room Implementation Tasks

This folder breaks the match prediction app into small implementation tasks for junior developers.

The current prototype is `docs/reference/match-prediction-sample.html`. Treat it as the product/design reference, not production architecture.

## Target Stack

- Frontend: Vue 3 + Vite + Bun
- Backend: Hono running on Bun or Node
- Database: Supabase Postgres
- Realtime: WebSocket endpoint in the Hono backend
- Hosting: self-hosted VM/VPS with Docker Compose and Caddy or Nginx

## Platform Ownership

Product owner will handle:

- Cloudflare/domain/DNS decisions.
- Supabase project creation.
- Supabase credentials.
- Production secrets.
- Final hosting target.

Junior developers should not provision Cloudflare or Supabase. They should implement the app against `.env.example`, SQL migration files, and the documented API contracts.

## Product Scope

Turntabl Score Room is a lightweight internal match-room app where users can:

- Choose a browser-local username.
- Submit one score prediction per room.
- Like predictions.
- Comment and reply to comments.
- Switch between match rooms.
- See updates live during match-day activity.

No formal authentication is required for v1.

## Suggested Implementation Order

1. `01-project-scaffold.md`
2. `02-database-schema.md`
3. `03-backend-api.md`
4. `04-realtime-websockets.md`
5. `05-frontend-app.md`
6. `06-admin-and-room-lifecycle.md`
7. `07-self-hosted-deployment.md`
8. `08-qa-and-launch-checklist.md`

## Ground Rules

- Keep v1 simple.
- Supabase is the source of truth.
- WebSockets are for live updates, not the only write path.
- Do not add login/auth unless explicitly requested.
- Optimize for a maximum expected concurrency of about 200 users.
- Preserve the current visual direction unless a task says otherwise.
- Keep platform-specific setup documented but do not block feature work on final hosting details.
