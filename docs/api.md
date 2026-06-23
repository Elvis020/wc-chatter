# API Reference

The API is a Hono app running as a Cloudflare Worker. It exposes room bootstrap, room mutation, admin, and websocket routes.

## Core Routes

```text
GET    /health
GET    /api/bootstrap
GET    /api/rooms/:roomId
POST   /api/rooms/:roomId/predictions
POST   /api/predictions/:predictionId/edit
POST   /api/predictions/:predictionId/likes
POST   /api/predictions/:predictionId/comments
POST   /api/comments/:commentId/replies
POST   /api/replies/:replyId/edit
GET    /api/admin/prize-claims
POST   /api/admin/prize-claims/:predictionId/pickup
GET    /ws/:roomId
```

## Room Reads

`GET /api/bootstrap`

Returns rooms, themes, and a generation timestamp. The web app uses this as its first room-board load.

`GET /api/rooms/:roomId`

Returns one hydrated room. `roomId` can be a database id or a slug when the backing store supports it.

## Mutations

Room mutations:

- validate and normalize JSON payloads
- enforce per-user mutation rate limits
- write through the active store
- return the updated room
- broadcast `room.updated`

Prediction creation accepts:

```ts
{
  authorId: string
  name: string
  homeScore: number
  awayScore: number
  comment?: string
  prizeQuestion?: string
  prizeAnswer?: string
}
```

Likes use:

```ts
{
  userId: string
  liked: boolean
}
```

Reply and comment bodies use:

```ts
{
  authorId: string
  name: string
  text: string
}
```

Edit routes require the editing `userId` and the replacement text/comment.

## Admin

`GET /api/admin/prize-claims`

Returns prediction rows with room, final-score, result, pickup-claim information, and prize collection status for the prize desk. It is not linked from the public UI; the route is meant for the hidden admin surface.

`POST /api/admin/prize-claims/:predictionId/pickup`

Marks a winner prize as collected or not collected. The request is gated by `ADMIN_PASSWORD`.

```ts
{
  adminPassword: string
  pickedUp: boolean
}
```

On success it returns the updated prize desk entry.

## WebSocket

`GET /ws/:roomId`

Connects the browser to room-scoped realtime events. The web client builds this from `VITE_WS_URL` plus the active room id.

Common event shapes live in `packages/shared/src/index.ts`.

## Error Shape

API errors return a structured code and message. Expected codes include validation, forbidden, not found, rate limited, and internal error cases.
