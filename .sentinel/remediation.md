# Remediation

## Local `.env.local`
1. Keep `.env.local` untracked and confirm `.gitignore` continues to exclude it.
2. Rotate the Supabase service role key if this machine, terminal output, screenshots, or logs could have exposed it.
3. Prefer storing production secrets in Cloudflare/Infisical/Supabase secret management, not in committed files.
4. Keep `.env.example` placeholder-only.

## Future Guardrails
1. Run Sentinel before deployment or public pushes.
2. Avoid printing env files in full; inspect variable names and masked values only.
3. Treat `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_TOKEN`, and any provider API tokens as server-only.

