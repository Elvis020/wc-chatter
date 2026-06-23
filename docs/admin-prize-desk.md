# Admin Prize Desk

The prize desk is the quiet back-room table for exact-score winners.

```text
/turntabl-prize-desk
```

It is intentionally hidden from public navigation. Keep it that way unless the product decision changes.

## What It Shows

- submitted predictions
- match and final score
- exact winner, miss, or pending status
- pickup question and private answer when supplied
- whether the prize has actually been collected
- submitted timestamp

The desk is desktop-first. On mobile, the app points admins toward a desktop view so the table and detail drawer stay usable.

## Pickup Verification

Users set a room name plus pickup question and private answer in the identity setup flow. When they submit a prediction, the API stores the pickup pair with that prediction as a prize claim.

If an older local browser has only a username and no pickup details, the app asks for setup before protected actions instead of pretending the user is prize-ready.

Pickup verification is not the same as collection:

- `pickup info` means the winner has a question and answer on file.
- `collected` means admin has marked that the winner came for the prize.

All winners are assumed eligible to come for pickup. The collected column tracks whether that has happened.

## Admin Password

Changing collected status opens a password drawer. The API checks `ADMIN_PASSWORD` and does not accept the update when it is missing or incorrect.

Local:

```bash
# apps/api/.dev.vars
ADMIN_PASSWORD=choose-a-local-admin-password
```

Production:

```bash
cd apps/api
bunx wrangler secret put ADMIN_PASSWORD --env production
```

## Winner Logic

Winner status is derived from the prediction score and the room final score:

- `pending` when no final score is available
- `winner` when the prediction exactly matches the final score
- `miss` otherwise

The shared prediction insight helpers own the scoring rules so web and API stay aligned.

## Implementation Notes

- The admin UI is lazy-loaded from `apps/web/src/components/AdminPrizeDesk.vue`.
- The API endpoint is `GET /api/admin/prize-claims`.
- Collected status is updated through `POST /api/admin/prize-claims/:predictionId/pickup`.
- Supabase stores pickup records in `public.prize_claims`.
- The fallback store supports the same prize-desk behavior for local development.
