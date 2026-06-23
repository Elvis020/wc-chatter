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
- submitted timestamp

The desk is desktop-first. On mobile, the app points admins toward a desktop view so the table and detail drawer stay usable.

## Pickup Verification

Users set a room name plus pickup question and private answer in the identity setup flow. When they submit a prediction, the API stores the pickup pair with that prediction as a prize claim.

If an older local browser has only a username and no pickup details, the app asks for setup before protected actions instead of pretending the user is prize-ready.

## Winner Logic

Winner status is derived from the prediction score and the room final score:

- `pending` when no final score is available
- `winner` when the prediction exactly matches the final score
- `miss` otherwise

The shared prediction insight helpers own the scoring rules so web and API stay aligned.

## Implementation Notes

- The admin UI is lazy-loaded from `apps/web/src/components/AdminPrizeDesk.vue`.
- The API endpoint is `GET /api/admin/prize-claims`.
- Supabase stores pickup records in `public.prize_claims`.
- The fallback store supports the same prize-desk behavior for local development.
