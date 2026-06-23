# Operations & Load Testing

This page covers the practical bits: deployment, scheduled sync, load testing, and cleanup.

## Deployment

The web app is a Vite static build from `apps/web`. The API deploys as a Cloudflare Worker from `apps/api`.

```bash
bun run build
bun --filter @turntabl-score-room/api deploy
```

For Cloudflare Pages, set:

```bash
VITE_API_URL=
VITE_WS_URL=
```

For the Worker, configure:

```bash
APP_ORIGIN=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
ADMIN_PASSWORD=
```

Use Wrangler secrets for Supabase and admin password values.

## Scheduled Sync

`apps/api/wrangler.jsonc` defines cron triggers for room sync and live score sync.

Manual commands:

```bash
bun --filter @turntabl-score-room/api sync:rooms
bun --filter @turntabl-score-room/api sync:live-scores
```

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

Regional latency still needs regional runners or machines near the actual audience.

## Preflight Checklist

- `bun run typecheck`
- `bun test`
- Supabase migrations applied
- `sync:rooms` has populated active rooms
- web env points to the deployed API and websocket base
- Worker `APP_ORIGIN` matches the web origin
- Worker `ADMIN_PASSWORD` is set before prize collection is used
