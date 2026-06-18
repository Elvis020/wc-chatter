# Task 05: Frontend App

## Goal

Convert the static prototype into a Vue/Vite application.

## Reference

Use `docs/reference/match-prediction-sample.html` as the visual and interaction reference.

## Views

### Main Room View

Components:

- App header and theme picker
- Match hero
- Top pick card
- Room switcher
- Username card
- Prediction feed
- Prediction submission sheet/modal
- Comment/reply controls

### Admin View

Basic route:

- `/admin`

Components:

- Create room form
- Update room status
- Hide comment/reply action

Admin can be simple for v1. No auth unless product owner requests it.

## State

Keep browser-local identity:

- `userId`: generated with `crypto.randomUUID()`
- `username`: user-entered, stored in localStorage

Keep room state loaded from API:

- active room
- rooms list
- predictions
- likes/comments/replies

## Realtime

- Open one WebSocket connection for the active room.
- Close previous room socket when switching room.
- Reconnect on failure.
- Refetch room state after reconnect.

## Mobile Requirements

Preserve the current mobile behavior:

- No horizontal overflow at 320px width.
- Match hero first, top pick/room switcher second, feed third.
- Main controls use 44px minimum touch targets.
- Bottom sheet close and submit controls stay in the viewport.

## Acceptance Criteria

- Frontend can load rooms from backend.
- User can set username.
- User can submit one prediction.
- User can like/unlike.
- User can comment and reply.
- Room switcher changes active room.
- Updates from another browser appear live.
- Mobile layout passes at 320px, 360px, and 390px widths.
