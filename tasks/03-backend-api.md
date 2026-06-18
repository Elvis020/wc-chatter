# Task 03: Backend API

## Goal

Build the Hono REST API used by the frontend.

## Endpoints

### Health

- `GET /health`

Response:

```json
{ "ok": true }
```

### Rooms

- `GET /rooms`
- `GET /rooms/:slug`

Room detail should include:

- room metadata
- predictions
- like counts
- comments
- one reply level
- current top prediction or most-backed score

### Predictions

- `POST /rooms/:slug/predictions`

Body:

```json
{
  "userId": "browser-user-id",
  "username": "Kojo",
  "homeScore": 2,
  "awayScore": 1,
  "take": "This is not patriotism. This is analysis."
}
```

Rules:

- Validate username.
- Validate scores are non-negative integers.
- Enforce one prediction per user per room.
- Reject writes to archived/closed rooms unless product owner decides otherwise.

### Likes

- `POST /predictions/:predictionId/like`
- `DELETE /predictions/:predictionId/like`

Body:

```json
{ "userId": "browser-user-id" }
```

Rules:

- One like per user per prediction.
- User cannot like their own prediction.

### Comments

- `POST /predictions/:predictionId/comments`

Body:

```json
{
  "userId": "browser-user-id",
  "username": "Ama",
  "text": "Safe prediction, dangerous confidence."
}
```

### Replies

- `POST /comments/:commentId/replies`

Body:

```json
{
  "userId": "browser-user-id",
  "username": "Ella",
  "text": "Framing this for when VAR gets involved."
}
```

## Validation

Implement shared validation helpers:

- username: 2-24 chars, letters, numbers, space, `.`, `'`, `-`
- comment/reply/take: trim, reject empty, max length 280
- score: integer, 0-99

## Error Format

Use one consistent error shape:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Username is required."
  }
}
```

## Acceptance Criteria

- All endpoints return JSON.
- Backend never exposes Supabase service role key.
- Duplicate prediction and duplicate like cases return clear errors.
- Successful mutations return the updated entity or room summary needed by the frontend.
- API is covered with basic endpoint tests or a documented smoke-test script.

