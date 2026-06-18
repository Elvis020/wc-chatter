import { existsSync, readFileSync } from 'node:fs'
import { createSupabaseClient, supabaseConfigFromEnv } from '../supabase-store.js'
import { syncCurrentCycleRooms } from '../room-sync.js'

function readEnvFile(url: URL) {
  if (!existsSync(url)) return {}

  return Object.fromEntries(
    readFileSync(url, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => {
        const index = line.indexOf('=')
        return [line.slice(0, index), line.slice(index + 1)]
      }),
  )
}

const dryRun = process.argv.includes('--dry-run')
const env = {
  ...readEnvFile(new URL('../../../../.env.local', import.meta.url)),
  ...readEnvFile(new URL('../../.dev.vars', import.meta.url)),
  ...process.env,
}
const supabase = createSupabaseClient(supabaseConfigFromEnv(env))
const result = await syncCurrentCycleRooms(supabase, { dryRun })

console.log(JSON.stringify(result, null, 2))
