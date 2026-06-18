# Task 08: QA And Launch Checklist

## Goal

Verify the app is ready before sharing the match-day link.

## Functional Checks

- User can set username.
- User can submit prediction.
- Duplicate prediction is blocked.
- User can like a prediction.
- Duplicate like is blocked.
- User cannot like own prediction.
- User can comment.
- User can reply to comment.
- Room switcher changes rooms.
- Closed/archived rooms behave as expected.
- Admin can create/close/archive room.

## Realtime Checks

Open two browsers side by side:

- Prediction created in Browser A appears in Browser B.
- Like in Browser A updates Browser B.
- Comment in Browser A appears in Browser B.
- Reply in Browser A appears in Browser B.
- Backend restart causes clients to reconnect and reload state.

## Mobile Checks

Test at:

- 320px width
- 360px width
- 390px width

Verify:

- No horizontal overflow.
- Main title fits.
- Top pick appears before feed.
- Touch targets are comfortable.
- Prediction sheet close and submit buttons stay visible/reachable.
- Theme picker opens downward and stays above content.

## Basic Load Check

Simulate or manually test:

- 20-30 simultaneous browser tabs if possible.
- Rapid likes.
- Rapid comments.

For v1, target expected peak is about 200 users, but manual pre-launch testing only needs to catch obvious problems.

## Content Checks

- Team names and 3-letter codes are correct.
- Flags render correctly.
- Event date is correct.
- Room status labels are correct.
- Copy is friendly and not misleading.

## Launch Checklist

- Supabase project created by owner.
- Migrations applied.
- Seed/live room created.
- Production env vars configured.
- Cloudflare/domain/DNS configured by owner, if applicable.
- HTTPS domain works.
- WebSocket endpoint works through proxy.
- Admin token stored securely.
- Smoke test passed on phone.
- Share link prepared.
