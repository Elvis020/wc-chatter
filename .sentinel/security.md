# Sentinel Security Scan

**Date:** 2026-06-19
**Mode:** full
**Scope:** working tree targeted scan, config/env files, high-value paths from `.codebase-indexer/docs/`, and guarded git-history pattern scan.

## Summary
- Findings: 1 high-severity local credential artifact.
- No critical tracked-file secret was found in the current scan.
- No high-confidence provider token pattern was found by the generic secret regex scan.
- Git history scan was guarded by commit count (`38`) and found credential-related commits by variable names/docs, not confirmed leaked values.

## Findings by Severity
| Severity | Count | Notes |
|---|---:|---|
| CRITICAL | 0 | No active secret detected in tracked source/config. |
| HIGH | 1 | Local untracked `.env.local` contains a Supabase service role key-shaped value. |
| MEDIUM | 0 | No unverified credential-like tracked value requiring review. |
| LOW | 1 | Generated Worker types mention token/password fields; treated as type-definition noise. |

## Scan Notes
- `.sentinel-ignore` was not present.
- `.codebase-indexer/docs/architecture.md` and `implementation.md` were read for targeting.
- `.env.local` is not listed by `git ls-files`, so the detected service-role-shaped value is local and not currently tracked.
- `.env.example` contains placeholder values only.
- `apps/api/src/worker-configuration.d.ts` contains generated type names such as `password`, `token`, and `max_tokens`; these are not secrets by themselves.

