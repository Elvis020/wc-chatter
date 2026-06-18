# Task 04: Realtime WebSockets

## Goal

Add live updates for rooms using a WebSocket endpoint in the backend.

Expected concurrency for v1 is about 200 users, so keep this simple. One backend process/replica is enough for launch.

## Endpoint

- `GET /rooms/:slug/live`

This upgrades to a WebSocket connection.

## Event Contract

Server sends JSON events:

```json
{
  "type": "prediction.created",
  "roomSlug": "ghana-england-2026",
  "payload": {}
}
```

Required event types:

- `room.updated`
- `prediction.created`
- `prediction.updated`
- `like.changed`
- `comment.created`
- `reply.created`
- `room.closed`

## Write Path

Do not make WebSocket messages the primary write path for v1.

Use:

```text
Frontend POSTs to REST endpoint
Backend writes to Supabase
Backend broadcasts event to WebSocket clients in that room
Frontend refetches or locally applies event
```

## Server Behavior

- Track clients by room slug in memory.
- On WebSocket close, remove client from room set.
- Send heartbeat/ping every 25-30 seconds if needed by runtime/proxy.
- Do not store critical state only in memory.
- If the process restarts, clients reconnect and refetch room state.

## Client Behavior

- Connect when a room is opened.
- Reconnect with backoff on disconnect.
- Refetch room detail on reconnect.
- Ignore events for other rooms.

## Acceptance Criteria

- Two browser windows in the same room see likes/comments/predictions update without refresh.
- Disconnect/reconnect works.
- If backend restarts, the UI reloads room state from Supabase after reconnect.
- Realtime code is isolated enough to replace later with Redis pub/sub or Cloudflare Durable Objects if needed.

