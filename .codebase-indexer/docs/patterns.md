# Patterns

## Naming Conventions
- Files: lowercase kebab or descriptive module names for scripts and docs; Vue components use PascalCase.
- Types/interfaces: PascalCase TypeScript exports such as `Room`, `Prediction`, `CreatePredictionInput`.
- Functions: camelCase verbs such as `submitPrediction`, `roomSplitPercentages`, `syncLiveRoomScores`.
- Constants: screaming snake case for global constants such as `ROOM_PAGE_SIZE`, `MATCH_LIVE_DURATION_MS`.
- IDs: app-generated strings are prefixed by domain, for example `prediction-*`, `comment-*`, `reply-*`, `user-*`.

## Folder Conventions
- `apps/web/src/` keeps app-level UI state in `App.vue`; reusable drawers live under `components/`; browser helpers live under `lib/`.
- `apps/api/src/` separates route orchestration (`server.ts`), Worker runtime (`worker.ts`), persistence (`store.ts`, `supabase-store.ts`), realtime (`room-hub.ts`), and sync scripts/providers.
- `packages/shared/src/` owns cross-runtime contracts and deterministic domain helpers.
- `supabase/migrations/` is append-only schema evolution.
- `tasks/` stores implementation planning and handoff notes.

## Recurring Code Patterns
- Error handling: API routes catch unknown errors and convert them through `errorResponse`; client fetch wrappers surface response error messages.
- Async: Frontend and API use `async`/`await`; Worker scheduled jobs use `ctx.waitUntil`.
- Dependency injection: API store is selected per environment via `storeFor(env)`; Durable Object fanout is used only when `ROOM_HUB` exists.
- Validation: HTTP input is normalized in `apps/api/src/validation.ts` and route-local parse functions before store mutation.
- Optimistic UI: `App.vue` inserts optimistic predictions/replies and patches/removes them when API responses arrive or fail.
- Realtime: Room updates are broadcast as shared `ApiEvent` JSON. Typing events are transient and not persisted.
- Theme/UI: Theme tokens are CSS custom properties in `styles.css`; most UI is built with Tailwind utility classes plus local CSS for app-specific motion and surfaces.

## Co-Change Coupling (Git History)
| File A | File B | Coupling Signal |
|---|---|---|
| `apps/web/src/App.vue` | `apps/web/src/styles.css` | Frequently co-changed during UI passes and carousel work |
| `apps/api/src/server.ts` | `apps/api/src/store.ts` / `apps/api/src/supabase-store.ts` | API contract changes usually need both route parsing and store support |
| `packages/shared/src/index.ts` | `apps/web/src/lib/api.ts` / `apps/api/src/server.ts` | Shared payload types bind frontend client and API route payloads |
| `supabase/migrations/*.sql` | `apps/api/src/supabase-store.ts` | Schema changes need row mapping/select updates |

## Testing Conventions
- Test files live in `apps/api/test/` and `packages/shared/test/`.
- Tests use Bun's `describe`/`test`/`expect` style.
- Current coverage is strongest around store hydration, fallback prize claims, and shared room-state helpers.
- UI behavior is currently verified mostly by typecheck/build/manual Playwright probes rather than component tests.

## Anti-Patterns Observed
- `apps/web/src/App.vue` is a large orchestration component; future UI work should consider extracting focused composables/components when behavior stabilizes.
- Some critical API/realtime/sync paths do not have direct tests yet.

