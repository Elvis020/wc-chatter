# Changelog

## 2026-06-29 — Internal room status updater
- Added a frontend room clock so live/upcoming/finished labels, room ordering, and prediction locking re-evaluate every minute even when no new API payload arrives.
- Hardened shared room-state derivation so stale provider `live` score states close after the fixture kickoff window has elapsed.
- Added finished-result and Annex C fixture seeds plus shared knockout slot resolution so `1C`, `3A/B/C/D/F`, and later `Wxx`/`Lxx` rooms resolve automatically when source results make them knowable.
- Scoped room sync and prediction creation to the active knockout round through the today/tomorrow match-cycle window, while keeping historical finished rooms visible on the public board.
- Added performance-conscious motion polish using staggered room/feed entrances, direction-aware room transitions, press feedback, and lightweight stat ticker pops.
- Consolidated repeated frontend transition utilities into shared motion primitives for press feedback, snappy controls, form fields, color changes, and card state changes.
- Added Pub/Grape Room-specific chat-room heading hooks so the sidebar and mobile room switcher keep high-contrast heading/icon color.
- Added regression coverage for stale live scores and verified the web/shared typechecks.

## 2026-06-19 — Initial index and readout carousel checkpoint
- Generated initial codebase index docs for the Bun/Vue/Hono/Cloudflare/Supabase app.
- Captured current architecture, implementation entry points, patterns, decisions, and test coverage.
- Ran Sentinel full scan. It found no tracked critical secret, but did identify local untracked `.env.local` containing a masked Supabase service role key-shaped value; remediation is documented in `.sentinel/`.
- Current UI checkpoint: the most-backed/readout card is now a compact carousel of room insights. `Top pick` ribbon appears only on the crowd-pick slide, dot pills indicate active slide, and the `Room split` slide uses a compact inline pitch SVG without increasing the desktop card height.
- Current data/product checkpoint: users can submit predictions without comments; pickup verification question/answer is collected during username setup and stored with prediction prize claims; exact-pick winners get crown UI after a match is finished.
- Current mobile checkpoint: room switcher is paginated with latest/current rooms first, prediction cards and sort controls were tightened, reply inputs focus on comment-icon tap, and feed navigation controls are comments/feed-oriented rather than hero-oriented.
- Verification most recently run before this index: `bun run typecheck` and `bun run build`.

## 2026-06-19 — Continue next session
- Continue from the sentiment/stat carousel polish if visual feedback remains. Keep the desktop readout card compact; do not add nested containers or increase card height for individual slides.
- Next feedback item from the feature list is avatar customization, unless the user reprioritizes.
- Before deploying, verify mobile dark-mode contrast again, especially tiny labels, username text, stat numbers, disabled states, and room status chips.
- If committing further UI work, include Playwright visual probes for desktop and mobile when feasible.
