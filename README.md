# Turntabl Score Room

Turntabl Score Room is a lightweight match-room app for World Cup score predictions. People pick a room, save a local room name, drop a score, like and reply to predictions, and watch simple room readouts shift as the crowd reacts.

The app is built for small, lively match-day use:

- score predictions with optional comments
- likes, replies, reply editing, and live typing signals
- room readout carousel with crowd pick, room split, banter weather, and winners
- pickup question and private answer for prize claiming
- hidden admin prize desk for checking exact-score winners
- Supabase persistence when configured, with an in-memory fallback for local development

## Workspace

```text
apps/web        Vue 3, Vite, Tailwind CSS UI
apps/api        Cloudflare Worker API, Hono, Durable Object room hub
packages/shared Shared types, fixture data, validation, room state, insights
supabase        SQL migrations for the persistent store
tasks           Older implementation notes and task briefs
```

## Requirements

- Bun
- Node-compatible shell
- Wrangler for Worker development and deployment
- Supabase project if you want persistent data

Install dependencies:

```bash
bun install
```

## Local Development

Run the web app and API together:

```bash
bun run dev
```

Defaults:

- Web: `http://localhost:5173`
- API: `http://localhost:8787`
- WebSocket base: `ws://localhost:8787/ws`

The API can run without Supabase secrets. In that mode it uses the fallback in-memory store, which is useful for quick UI work but resets when the API process restarts.

## Environment

Create local env files as needed.

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
```

Production `APP_ORIGIN` is configured in `apps/api/wrangler.jsonc`. Supabase secrets should be set with Wrangler rather than committed.

```bash
cd apps/api
bunx wrangler secret put SUPABASE_URL --env production
bunx wrangler secret put SUPABASE_SERVICE_ROLE_KEY --env production
```

## Supabase

Apply the SQL files in `supabase/migrations` in filename order:

```text
0001_initial_schema.sql
0002_room_sync_metadata.sql
0003_content_edit_metadata.sql
0003_room_visibility_model.sql
0004_room_scoreline_state.sql
0005_prize_claims.sql
```

After migrations, reload the PostgREST schema if your Supabase project does not pick up the `notify pgrst, 'reload schema';` statements immediately.

Sync rooms from the shared fixture data:

```bash
bun --filter @turntabl-score-room/api sync:rooms
```

Refresh live scores:

```bash
bun --filter @turntabl-score-room/api sync:live-scores
```

The Worker has cron triggers for room sync and live-score sync in `apps/api/wrangler.jsonc`.

## Useful Commands

```bash
bun run dev
bun run build
bun run typecheck
bun test
```

Package-specific commands:

```bash
bun --filter @turntabl-score-room/web dev
bun --filter @turntabl-score-room/web build
bun --filter @turntabl-score-room/web typecheck

bun --filter @turntabl-score-room/api dev
bun --filter @turntabl-score-room/api build
bun --filter @turntabl-score-room/api deploy
bun --filter @turntabl-score-room/api typecheck

bun --filter @turntabl-score-room/shared build
bun --filter @turntabl-score-room/shared typecheck
```

## API Surface

Core endpoints:

```text
GET    /api/bootstrap
GET    /api/rooms/:roomId
POST   /api/rooms/:roomId/predictions
POST   /api/predictions/:predictionId/edit
POST   /api/predictions/:predictionId/likes
POST   /api/predictions/:predictionId/comments
POST   /api/comments/:commentId/replies
POST   /api/replies/:replyId/edit
GET    /api/admin/prize-claims
GET    /ws/:roomId
```

Room mutations broadcast `room.updated` events through the Durable Object room hub when running on Workers. Without the Durable Object binding, the local fallback store broadcasts to in-process clients.

## Admin Prize Desk

The admin surface lives at:

```text
/turntabl-prize-desk
```

It is intentionally a hidden route, not a public navigation item. It lists predictions, final scores, winner status, and pickup verification details for exact-score winners. On mobile, the app asks admins to use a desktop view.

## Fixture and Room Logic

Fixture data lives in `packages/shared/src/data`. Shared helpers derive:

- kickoff timestamps
- active match cycles
- room locked/open state
- current or next room slate
- readout carousel insights
- exact-score winner status

Keep fixture and room behavior in `packages/shared` when possible so API and web stay aligned.

## Testing and Verification

Run everything:

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

Before shipping UI-heavy work, run the app locally and check both desktop and mobile widths.

## Load Testing

Run the local chat load test:

```bash
bun --filter @turntabl-score-room/api load:test
```

Run it against a deployed API:

```bash
LOAD_TEST_API_URL=https://your-api.example.com \
LOAD_TEST_WS_URL=wss://your-api.example.com/ws \
bun --filter @turntabl-score-room/api load:test
```

Audience mix labels simulated users only:

```bash
LOAD_TEST_AUDIENCE_MIX=GH:70,UK:10,US:10,IE:10 \
bun --filter @turntabl-score-room/api load:test
```

Hotspot reply scenario:

```bash
LOAD_TEST_USERS=300 \
LOAD_TEST_SOCKETS=300 \
LOAD_TEST_SCENARIO=reply-hotspot \
LOAD_TEST_AUDIENCE_MIX=GH:70,UK:10,US:10,IE:10 \
bun --filter @turntabl-score-room/api load:test
```

Clean up generated load-test data:

```bash
bun --filter @turntabl-score-room/api load:cleanup
```

Regional latency still needs regional runners or machines near the audience.

## Deployment Notes

Web deployment is a Vite static build from `apps/web`. The API deploys as a Cloudflare Worker from `apps/api`.

```bash
bun run build
bun --filter @turntabl-score-room/api deploy
```

For Cloudflare Pages, set `VITE_API_URL` and `VITE_WS_URL` for the web build environment. For the Worker, configure `APP_ORIGIN`, `SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY`.

## Development Notes

- User identity and pickup verification are browser-local.
- Usernames are capped at 24 characters in the UI and validation layer.
- Supabase queries use schema fallbacks so older local databases can still boot while migrations are being applied.
- Room hydration is briefly cached in the API to soften duplicate reads after rapid mutations.
- The admin prize desk is lazy-loaded so normal room visitors do not load the admin table and drawer UI.
- The prediction feed progressively renders long rooms to keep busy match pages responsive.
