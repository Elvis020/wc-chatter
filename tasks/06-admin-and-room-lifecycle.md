# Task 06: Admin And Room Lifecycle

## Goal

Implement enough admin tooling to reuse the app for future matches.

## Room Statuses

- `draft`: not visible in public switcher unless admin is viewing.
- `live`: current main event.
- `closed`: readable, no new predictions/comments unless explicitly allowed.
- `archived`: historical/reference room.

## Admin Features

Minimum v1:

- Create room.
- Edit room metadata.
- Set room status.
- Mark one room as live.
- Hide comment.
- Hide reply.

## Routes

- Public app: `/`
- Admin app: `/admin`

## Backend Endpoints

- `POST /admin/rooms`
- `PATCH /admin/rooms/:roomId`
- `POST /admin/rooms/:roomId/status`
- `POST /admin/comments/:commentId/hide`
- `POST /admin/replies/:replyId/hide`

## Auth Decision

For internal testing, admin can be protected by one shared admin token:

```http
Authorization: Bearer <ADMIN_TOKEN>
```

Store `ADMIN_TOKEN` in `.env`, not the frontend bundle.

If this is too much for v1, keep admin local-only and create rooms with SQL seeds.

## Acceptance Criteria

- Admin can create a new room without code changes.
- Admin can close/archive a room.
- Public room switcher reflects live/open/archived states.
- Hidden comments/replies no longer render publicly.

