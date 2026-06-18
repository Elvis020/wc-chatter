# Task 07: Self-Hosted Deployment

## Goal

Prepare the app for a small self-hosted deployment.

The project owner will handle the actual Cloudflare/domain and Supabase setup. This task is about making the app deployable and documenting what the owner needs to provide.

## Recommended Shape

```text
VM/VPS
  Caddy or Nginx
  app container
    serves API
    serves WebSocket endpoint
    optionally serves frontend static files
  Supabase hosted Postgres
```

## Docker Compose

Create:

- `Dockerfile`
- `docker-compose.yml`
- `Caddyfile` or `nginx.conf`
- `.env.example`

## Runtime

The simplest v1 deployment can be one app process:

```text
Hono backend serves:
  /api/*
  /rooms/:slug/live WebSocket
  Vue dist files
```

Alternative:

```text
Caddy serves frontend static files
Caddy reverse-proxies /api and /rooms/:slug/live to backend
```

Use whichever is simpler to maintain.

## Owner-Provided Values

The project owner will provide:

- final domain
- Cloudflare/DNS setup, if used
- Supabase project URL
- Supabase service role key
- Supabase anon key, if needed
- production admin token
- target VM/VPS details

## TLS

Use Caddy if possible because it handles HTTPS certificates automatically.

## Environment Variables

```env
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_ANON_KEY=
APP_ORIGIN=https://your-domain.example
ADMIN_TOKEN=
PORT=8787
```

## Backups

Do not configure Supabase backups. Document the values the owner should record:

- project URL
- database region
- how to export a backup
- who owns the Supabase project

## Acceptance Criteria

- App is reachable over HTTPS.
- WebSocket connection works through the reverse proxy.
- App restarts automatically after VM reboot.
- Logs are accessible with `docker compose logs`.
- Deployment instructions are documented in `README.md`.
- Deployment docs clearly list all owner-provided Cloudflare/Supabase values.

## Out Of Scope

- Cloudflare account setup.
- DNS changes.
- Supabase project creation.
- Production secret rotation.
