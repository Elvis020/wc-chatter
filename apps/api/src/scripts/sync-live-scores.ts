import { existsSync, readFileSync } from 'node:fs'
import { createSupabaseClient, supabaseConfigFromEnv } from '../supabase-store.js'
import { syncLiveRoomScores } from '../live-score-sync.js'

function readEnvFile(url: URL) {
  if (!existsSync(url)) return {}

  return Object.fromEntries(
    readFileSync(url, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => {
        const index = line.indexOf('=')
        return [line.slice(0, index), line.slice(index + 1).replace(/^(['"])(.*)\1$/, '$2')]
      }),
  )
}

const nowFlag = process.argv.find((arg) => arg.startsWith('--now='))?.slice('--now='.length)
const dryRun = process.argv.includes('--dry-run')
const env = {
  ...readEnvFile(new URL('../../../../.env.local', import.meta.url)),
  ...readEnvFile(new URL('../../.dev.vars', import.meta.url)),
  ...process.env,
}
const supabase = createSupabaseClient(supabaseConfigFromEnv(env))
const result = await syncLiveRoomScores(supabase, { now: nowFlag ? new Date(nowFlag) : undefined, dryRun })

console.log(JSON.stringify(result, null, 2))
