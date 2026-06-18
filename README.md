# WC Chatter

Simple match-room app for score predictions, likes, replies, and live room switching.

## Stack

- `apps/web` - Vue 3, Vite, Tailwind CSS
- `apps/api` - Cloudflare Worker, Hono
- `packages/shared` - shared TypeScript types and mock data
- `supabase` - database schema/migrations

## Setup

```bash
bun install
```

Create local env files as needed:

```bash
# apps/web
VITE_API_URL=http://localhost:8787
VITE_WS_URL=ws://localhost:8787/ws

# apps/api
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
APP_ORIGIN=http://localhost:5173
```

The API can run without Supabase config by using the fallback store.

## Commands

```bash
bun run dev
bun run build
bun run typecheck
```

Useful app-specific commands:

```bash
bun --filter @wc-chatter/web dev
bun --filter @wc-chatter/api dev
bun --filter @wc-chatter/api sync:rooms
```
