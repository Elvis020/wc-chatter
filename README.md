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

## Load Testing

Run the local 100-user chat load test:

```bash
bun --filter @wc-chatter/api load:test
```

Run it against a deployed API:

```bash
LOAD_TEST_API_URL=https://your-api.example.com \
LOAD_TEST_WS_URL=wss://your-api.example.com/ws \
bun --filter @wc-chatter/api load:test
```

The default audience mix tags simulated users as Ghana-heavy:

```bash
LOAD_TEST_AUDIENCE_MIX=GH:70,UK:10,US:10,IE:10 bun --filter @wc-chatter/api load:test
```

That mix is for scenario labeling only. Real regional latency must be measured by running the same deployed test from regional runners or machines near the audience, especially Ghana, UK, US, and Ireland.
