# Development Setup

This guide covers the day-to-day local setup for Turntabl Score Room.

## Requirements

- Bun
- Node-compatible shell
- Wrangler for Worker development and deployment
- Supabase project when you need persistent data

Install dependencies from the repo root:

```bash
bun install
```

## Run Locally

Start the web app and API together:

```bash
bun run dev
```

Defaults:

- Web: `http://localhost:5173`
- API: `http://localhost:8787`
- WebSocket base: `ws://localhost:8787/ws`

The API can run without Supabase config. It falls back to an in-memory store, which is perfect for quick UI work and disposable demos.

## Environment

`apps/web/.env.local`

```bash
VITE_API_URL=http://localhost:8787
VITE_WS_URL=ws://localhost:8787/ws
VITE_ENABLE_USERNAME_RESET=true
```

`apps/api/.dev.vars`

```bash
APP_ORIGIN=http://localhost:5173
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
ADMIN_PASSWORD=
```

Production `APP_ORIGIN` lives in `apps/api/wrangler.jsonc`. Supabase and admin password values should be Wrangler secrets, not committed env files.

```bash
cd apps/api
bunx wrangler secret put SUPABASE_URL --env production
bunx wrangler secret put SUPABASE_SERVICE_ROLE_KEY --env production
bunx wrangler secret put ADMIN_PASSWORD --env production
```

## Supabase

Apply migrations in filename order:

```text
0001_initial_schema.sql
0002_room_sync_metadata.sql
0003_content_edit_metadata.sql
0003_room_visibility_model.sql
0004_room_scoreline_state.sql
0005_prize_claims.sql
0006_prize_pickup_collection.sql
```

If Supabase does not pick up new columns immediately, reload the PostgREST schema.

Sync rooms from shared fixture data:

```bash
bun --filter @turntabl-score-room/api sync:rooms
```

Refresh live scores:

```bash
bun --filter @turntabl-score-room/api sync:live-scores
```

## Scripts

Root scripts:

```bash
bun run dev
bun run build
bun run typecheck
bun test
```

Web:

```bash
bun --filter @turntabl-score-room/web dev
bun --filter @turntabl-score-room/web build
bun --filter @turntabl-score-room/web typecheck
```

API:

```bash
bun --filter @turntabl-score-room/api dev
bun --filter @turntabl-score-room/api build
bun --filter @turntabl-score-room/api deploy
bun --filter @turntabl-score-room/api typecheck
```

Shared:

```bash
bun --filter @turntabl-score-room/shared build
bun --filter @turntabl-score-room/shared typecheck
```

## Verification

Run everything before handing off broad changes:

```bash
bun run typecheck
bun test
```

Focused examples:

```bash
bun test packages/shared/test/fixtures.test.ts
bun test apps/api/test/supabase-store.test.ts apps/api/test/store.test.ts
bun test apps/web/src/lib/prediction-thread.test.ts apps/web/src/lib/room-cache.test.ts
```

For UI changes, also run the app locally and check desktop and mobile widths.
