# Secrets Found

## HIGH — Local Supabase service role key in `.env.local`
- **File:** `.env.local`
- **Key:** `SUPABASE_SERVICE_ROLE_KEY`
- **Masked value:** `eyJh...oFOI`
- **Tracked by git:** no
- **Why it matters:** service role keys are privileged server-side credentials. Even when local and ignored, they should be treated as sensitive and rotated if they may have been exposed outside the machine.

## LOW — Generated credential-related type names
- **File:** `apps/api/src/worker-configuration.d.ts`
- **Examples:** generated fields/docs containing `password`, `token`, and `max_tokens`
- **Tracked by git:** yes
- **Assessment:** type-definition noise, not a concrete secret value.

