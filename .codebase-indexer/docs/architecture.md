# Architecture

## Project Type
Bun workspace monorepo for a World Cup score-room app:
- Vue 3 + Vite + Tailwind CSS frontend in `apps/web`
- Cloudflare Worker API using Hono in `apps/api`
- Shared TypeScript types, fixtures, and room-state helpers in `packages/shared`
- Supabase SQL migrations and seed data in `supabase`

## Directory Map
| Path | Purpose |
|---|---|
| `apps/web/src/` | Vue single-page app, API client, local storage, avatar generation, and global styling |
| `apps/web/src/components/` | Reusable bottom-drawer components for username setup and score submission |
| `apps/api/src/` | Hono routes, Worker entry, Durable Object room hub, Supabase/fallback stores, sync scripts |
| `apps/api/test/` | API/store-focused Bun tests |
| `packages/shared/src/` | Shared domain types, fixture loading, mock rooms, room status/sorting helpers |
| `packages/shared/test/` | Shared room-state tests |
| `supabase/migrations/` | Database schema evolution for rooms, predictions, comments, score state, and prize claims |
| `tasks/` | Planning and implementation task notes |
| `docs/reference/` | Product/reference artifacts and sample UI documents |

## Module Overview
| Module/Package | Purpose |
|---|---|
| `apps/web` | User-facing score room with room switcher, predictions feed, reply/edit flows, themes, and readout carousel |
| `apps/api` | HTTP API, WebSocket fanout, rate-limited mutations, Supabase persistence, fallback in-memory store, scheduled syncs |
| `packages/shared` | Shared contracts for rooms/predictions/replies/themes plus fixture and match-state derivation |
| `supabase` | Persistent data model used by the production API store |

## Execution Entry Map
| Entry Point | Type | Notes |
|---|---|---|
| `apps/web/src/main.ts` | Runtime | Mounts the Vue SPA and imports the global stylesheet |
| `apps/api/src/worker.ts:default.fetch` | Worker HTTP | Cloudflare Worker ingress; delegates requests to the Hono app |
| `apps/api/src/worker.ts:default.scheduled` | Scheduler | Runs daily room sync and per-minute live-score sync from cron triggers |
| `apps/api/src/worker.ts:RoomHub` | Worker Durable Object | Exports the realtime room hub class for WebSocket fanout |
| `apps/api/src/index.ts:default.fetch` | HTTP | Local Bun-compatible API entry with configurable `PORT` |
| `apps/api/src/server.ts:app` | HTTP | Hono route definitions for bootstrap, predictions, likes, edits, replies, admin claims, and WebSocket upgrade |
| `apps/api/src/scripts/sync-rooms.ts` | CLI | Runs room sync against Supabase from fixture data |
| `apps/api/src/scripts/sync-live-scores.ts` | CLI | Runs live score sync manually |
| `apps/api/src/scripts/load-test.ts` | CLI | Simulates prediction/reply activity and WebSocket load |
| `apps/api/src/scripts/cleanup-load-test.ts` | CLI | Deletes load-test artifacts from Supabase |

## Data Flow
1. Browser loads `apps/web` and calls `GET /api/bootstrap` through `apps/web/src/lib/api.ts`.
2. `apps/api/src/server.ts` chooses a Supabase-backed store when `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` exist, otherwise it uses the fallback store from `apps/api/src/store.ts`.
3. User mutations post to Hono routes; server-side validation normalizes IDs, names, scores, text, and pickup verification fields.
4. Successful mutations update the store, return the updated room, and broadcast a `room.updated` event through either `RoomHub` or fallback in-process clients.
5. The SPA patches local room state, updates optimistic items, and uses WebSocket typing/room events for live feedback.
6. Scheduled Worker jobs sync current-cycle rooms and live scorelines into Supabase, which then influence room ordering, locking, final-score display, and exact-pick winner UI.

## Multi-Layer Context Artifacts
| Artifact | Location | Why It Matters |
|---|---|---|
| Database schema | `supabase/migrations/*.sql` | Defines rooms, predictions, likes, comments, replies, visibility/status fields, edit metadata, scoreline state, and prize claims |
| API contract | `apps/api/src/server.ts`, `packages/shared/src/index.ts` | Endpoint paths and request/response payload types are code-first; no OpenAPI spec found in scan |
| Runtime topology | `apps/api/wrangler.jsonc` | Defines Worker entry, production origin, Durable Object binding, SQLite DO migration, observability, and cron schedules |
| Frontend runtime config | `apps/web/vite.config.ts`, `apps/web/src/lib/api.ts` | Defines Vite/Tailwind/Vue setup and browser API/WebSocket base URLs |
| Fixture data | `packages/shared/src/data/worldcup*.json` | Supplies match rooms, teams, ISO flags, kickoff windows, and fallback match data |

## External Dependencies
| Name | Purpose |
|---|---|
| `vue` | Frontend component/runtime framework |
| `vite` | Web dev server and production build |
| `tailwindcss` / `@tailwindcss/vite` | Utility-first styling pipeline |
| `flag-icons` | Sprite-based country/subdivision flags |
| `hono` | Worker-compatible HTTP router |
| `@supabase/supabase-js` | Supabase persistence client |
| `wrangler` | Cloudflare Worker/Durable Object dev, type generation, and deploy dry run |
| `@cloudflare/workers-types` | Worker/Durable Object TypeScript types |
| `typescript` / `vue-tsc` | Typechecking and shared package builds |
| `bun` | Workspace package manager, runtime, test runner, and scripts |

