# Turntabl Score Room

[![Vue 3](https://img.shields.io/badge/Vue-3-42b883?logo=vue.js&logoColor=white)](https://vuejs.org/)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-f38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![Bun](https://img.shields.io/badge/Bun-ready-14151a?logo=bun&logoColor=white)](https://bun.sh/)
[![Supabase](https://img.shields.io/badge/Supabase-optional-3ecf8e?logo=supabase&logoColor=white)](https://supabase.com/)

Match rooms for score predictions, quick banter, crowd momentum, and exact-score bragging rights.

Turntabl Score Room is intentionally small and lively: pick a match, drop your score, reply to spicy predictions, like the ones you rate, and let the room readout turn the chatter into simple match-day stats.

## Quick Start

```bash
bun install
bun run dev
```

Local defaults:

- Web: `http://localhost:5173`
- API: `http://localhost:8787`
- WebSocket base: `ws://localhost:8787/ws`

The API can run with no Supabase secrets, using an in-memory fallback store. That makes UI work delightfully low-friction, but data resets when the API restarts.

## What It Does

- score predictions with optional opening comments
- likes, replies, reply editing, and live typing signals
- room readout carousel for crowd pick, room split, banter weather, and winners
- pickup question and private answer for prize claiming
- hidden admin prize desk for checking exact-score winners
- Supabase persistence when configured, local fallback when not

## Documentation

| Guide | What is inside |
| --- | --- |
| [Development Setup](docs/development.md) | Local env, scripts, Supabase setup, and verification commands |
| [Architecture](docs/architecture.md) | Workspace layout, data flow, realtime model, and shared domain boundaries |
| [API Reference](docs/api.md) | REST routes, websocket route, mutation behavior, and admin endpoint |
| [Admin Prize Desk](docs/admin-prize-desk.md) | Hidden route, winner review flow, and pickup verification notes |
| [Operations & Load Testing](docs/operations.md) | Deployment notes, cron jobs, load-test commands, and cleanup |

## Workspace

```text
apps/web         Vue 3, Vite, Tailwind CSS UI
apps/api         Cloudflare Worker API, Hono, Durable Object room hub
packages/shared  Types, fixtures, validation, room state, insights
supabase         SQL migrations for persistent storage
docs             Human-friendly project guides
tasks            Earlier task briefs and implementation notes
```

## Daily Commands

```bash
bun run typecheck
bun test
bun run build
```

Package-specific scripts live in [Development Setup](docs/development.md).

## Project Rhythm

Keep product behavior playful, but keep the code boring in the best way:

- shared room rules belong in `packages/shared`
- API orchestration belongs in `apps/api`
- UI-specific polish belongs in `apps/web`
- docs should stay short enough to actually read

That is the whole little stadium. Bring predictions.
