# Task 01: Project Scaffold

## Goal

Create the production project structure for the Turntabl Score Room app.

## Scope

Set up:

- Vue 3 frontend with Vite and Bun.
- Hono backend.
- Shared TypeScript types package or shared folder.
- Local dev scripts.
- Basic lint/typecheck/build commands.

## Suggested Structure

```text
turntabl-score-room/
  apps/
    web/
      src/
      package.json
      vite.config.ts
    api/
      src/
      package.json
      tsconfig.json
  packages/
    shared/
      src/
      package.json
  tasks/
  docker-compose.yml
  README.md
```

If a simpler monorepo layout is preferred, keep it simple, but maintain clear separation between frontend and backend.

## Requirements

- `bun install` works from the repo root.
- `bun run dev` starts frontend and backend locally.
- `bun run build` builds frontend and backend.
- `bun run typecheck` passes.
- Add `.env.example` with all required env names and dummy values.

## Environment Variables

```env
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_ANON_KEY=
API_PUBLIC_URL=
VITE_API_URL=
VITE_WS_URL=
APP_ORIGIN=
PORT=8787
```

## Acceptance Criteria

- A developer can clone the repo, copy `.env.example` to `.env`, install dependencies, and run the app locally.
- Frontend can call backend health check.
- Backend exposes `GET /health` returning `{ "ok": true }`.
