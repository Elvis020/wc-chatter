# Implementation

## Entry Points
- `apps/web/src/main.ts` mounts the Vue app.
- `apps/web/src/App.vue` contains most UI state, room switching, feed interactions, typing indicators, optimistic updates, edit flows, and readout carousel behavior.
- `apps/api/src/server.ts` defines the Hono app and all public API routes.
- `apps/api/src/worker.ts` is the Cloudflare Worker runtime entry and scheduler.
- `apps/api/src/index.ts` is the local Bun-style API entry.
- `packages/shared/src/index.ts` exports shared contracts consumed by both web and API.
- `packages/shared/src/fixtures.ts` loads World Cup fixtures and team metadata.
- `packages/shared/src/room-state.ts` derives live/upcoming/finished state and room ordering.

## Per-Module Breakdown

### Frontend App
- **Entry point:** `apps/web/src/App.vue`
- **Key functions:** `submitPrediction`, `submitLike`, `submitReply`, `submitPredictionEdit`, `submitReplyEdit`, `buildTopPickInsights`, `roomSplitPercentages`, `connectActiveRoomEvents`, `updateLocalPrediction`, `updateLocalReplyThread`
- **Initialization:** On mount, loads stored theme/identity, fetches bootstrap data, connects WebSocket for active room, installs global click/resize/scroll listeners, and starts room refresh/readout carousel timers.
- **Non-obvious logic:** Prediction comments are optional on create but edits require minimum comment text. The room readout carousel is JS-driven via `activeTopPickIndex`; the room-split slide uses a compact inline pitch SVG and dot pills.

### Frontend Components
- **Entry points:** `apps/web/src/components/ScoreDrawer.vue`, `apps/web/src/components/IdentityPrompt.vue`
- **Key behavior:** Both use bottom-sheet modal patterns. `IdentityPrompt` also collects prize pickup question/answer used later for winner verification. `ScoreDrawer` submits score, optional comment, and locked-room disabled states.

### Frontend Libraries
- **Entry points:** `apps/web/src/lib/api.ts`, `apps/web/src/lib/storage.ts`, `apps/web/src/lib/navii.ts`
- **Key behavior:** API client wraps fetch/WebSocket endpoints and parses error payloads. Storage keeps user ID, username, pickup verification, likes, theme, active room, and drafts in localStorage with memory fallback. Navii generates deterministic SVG avatars.

### API Routes
- **Entry point:** `apps/api/src/server.ts`
- **Key routes:** `GET /health`, `GET /api/bootstrap`, `POST /api/rooms/:roomId/predictions`, `POST /api/predictions/:predictionId/likes`, `POST /api/predictions/:predictionId/edit`, `POST /api/comments/:commentId/replies`, `POST /api/replies/:replyId/edit`, `GET /api/admin/prize-claims`, `GET /ws/:roomId`
- **Initialization:** Hono app is imported by both Worker and local runtime entries.
- **Non-obvious logic:** Store selection is environment-driven. Mutations are rate-limited by user/action. Admin prize claims require bearer token. WebSocket routing requires Durable Object binding in Worker runtime.

### Persistence Stores
- **Entry points:** `apps/api/src/store.ts`, `apps/api/src/supabase-store.ts`
- **Key behavior:** Fallback store keeps rooms, likes, clients, and prize claims in memory. Supabase store maps normalized DB rows to shared `Room`/`Prediction`/`Reply` shapes and writes predictions, likes, edits, replies, and prize claims.
- **Non-obvious logic:** Supabase queries include fallback select shapes for older schema states. Rooms hidden by room status are filtered out. Finished/closed rooms reject prediction and edit mutations.

### Realtime
- **Entry point:** `apps/api/src/room-hub.ts`
- **Key behavior:** Durable Object stores connected WebSockets per room, broadcasts JSON events, and relays typing events without persistence.

### Sync Jobs
- **Entry points:** `apps/api/src/room-sync.ts`, `apps/api/src/live-score-sync.ts`, `apps/api/src/live-score-providers.ts`
- **Key behavior:** Room sync upserts current-cycle rooms from fixture data. Live score sync merges provider scorelines and updates current score/match status fields for candidate rooms.

### Shared Package
- **Entry points:** `packages/shared/src/index.ts`, `packages/shared/src/fixtures.ts`, `packages/shared/src/room-state.ts`, `packages/shared/src/mock-data.ts`
- **Key behavior:** Shared types keep frontend/API contracts aligned. Fixture helpers derive teams, FIFA codes, subdivision flag IDs, kickoff windows, and room ordering.

## Configuration
| Variable / Property | Default | Purpose |
|---|---|---|
| `VITE_API_URL` | `http://localhost:8787` | Browser API base URL |
| `VITE_WS_URL` | `ws://localhost:8787/ws` | Browser WebSocket base URL |
| `VITE_ENABLE_USERNAME_RESET` | enabled unless `'false'` | Shows/hides username reset control |
| `SUPABASE_URL` | none | Enables Supabase store when paired with service role key |
| `SUPABASE_SERVICE_ROLE_KEY` | none | Server-side Supabase credential |
| `ADMIN_TOKEN` | none | Required bearer token for admin prize claims |
| `APP_ORIGIN` | Worker var / `*` fallback | CORS origin |
| `PORT` | `8787` | Local Bun API port for `apps/api/src/index.ts` |
| `ROOM_HUB` | Wrangler binding | Durable Object namespace for WebSocket fanout |
| `LOAD_TEST_*` | see `README.md` | Controls API load-test scenarios |

## Test Coverage
> Claude-inferred — not a coverage report. Based on naming convention and import/source scan.

| Module / Function | Test File |
|---|---|
| `apps/api/src/store.ts:createStore` prize claim path | `apps/api/test/store.test.ts` |
| `apps/api/src/supabase-store.ts:mapPredictions` | `apps/api/test/supabase-store.test.ts` |
| `packages/shared/src/room-state.ts` status/sorting helpers | `packages/shared/test/room-state.test.ts` |
| `packages/shared/src/fixtures.ts` subdivision flag mapping | `packages/shared/test/room-state.test.ts` |
| `apps/api/src/server.ts` route validation/rate limits | — no direct route test found |
| `apps/api/src/room-hub.ts` WebSocket/typing fanout | — no direct test found |
| `apps/api/src/live-score-sync.ts` live score sync | — no direct test found |
| `apps/api/src/room-sync.ts` room sync | — no direct test found |
| `apps/web/src/App.vue` UI interactions/readout carousel | — no direct component test found |
| `apps/web/src/components/ScoreDrawer.vue` | — no test found |
| `apps/web/src/components/IdentityPrompt.vue` | — no test found |

