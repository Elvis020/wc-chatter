# Architectural Decisions

> ADR entries explain WHY — not what was built, but why it was built that way.

## Bun workspace with shared domain package
**Date:** 2026-06-19
**Why:** Keep frontend and API contracts aligned while preserving a simple deploy shape for a small app.
**Why (inferred):** Commit history includes `a3fc2a9 feat(api): serve match rooms and realtime events`, `4c7c2f0 feat(api): add Supabase persistence and room sync`, and many UI/API co-evolution commits. Exact original rationale is otherwise not determinable from git history.
**Tradeoffs:** Shared package build/type exports add workspace coordination.
**Alternatives considered:** Separate frontend/API repositories or duplicated DTO definitions.

## Cloudflare Worker plus Durable Object realtime
**Date:** 2026-06-19
**Why:** Keep the backend small while supporting WebSocket room fanout and scheduled syncs.
**Why (inferred):** Worker entry and `ROOM_HUB` binding are present in `apps/api/wrangler.jsonc`; commit history references realtime events and load testing. Deeper rationale is not determinable from git history.
**Tradeoffs:** Local/dev parity must account for Worker-specific bindings; Durable Object availability gates production realtime behavior.
**Alternatives considered:** Dedicated Node server with sticky sessions/Redis, Supabase Realtime, or Cloudflare Durable Objects alone.

## Supabase store with in-memory fallback
**Date:** 2026-06-19
**Why:** Let local/dev flows work without Supabase credentials while production can persist rooms, predictions, replies, likes, scores, and prize claims.
**Why (inferred):** README explicitly states the API can run without Supabase config by using fallback store. Commit `4c7c2f0` added Supabase persistence and room sync.
**Tradeoffs:** Fallback behavior must stay aligned with Supabase behavior; tests should cover both where possible.
**Alternatives considered:** Supabase-only runtime or SQLite-only self-hosted service.

## Local identity plus prize pickup verification
**Date:** 2026-06-19
**Why:** Keep the public prediction flow lightweight while giving admins a physical pickup verification question/answer when users win.
**Why (inferred):** Commit `51b67c4 Move prize pickup verification to identity setup` records the shift from post-win claim drawer to identity setup. This followed product discussion in the session.
**Tradeoffs:** Identity is browser-local and not strong authentication; prize pickup still depends on human/admin verification.
**Alternatives considered:** Post-match claim drawer or fully authenticated accounts.

## JS-driven readout carousel
**Date:** 2026-06-19
**Why:** The most-backed/readout card needs a deterministic carousel with synchronized dot pills and compact sentiment/stat slides.
**Why (inferred):** Current uncommitted change replaces fragile CSS delay math with explicit `activeTopPickIndex`; reason comes from current session debugging rather than historical commits.
**Tradeoffs:** Adds a small interval timer and lifecycle cleanup in `App.vue`.
**Alternatives considered:** CSS-only carousel with animation delays.

