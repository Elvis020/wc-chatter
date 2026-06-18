import { app } from './server.js'
import { syncLiveRoomScores } from './live-score-sync.js'
import { syncCurrentCycleRooms } from './room-sync.js'
import { createSupabaseClient, supabaseConfigFromEnv } from './supabase-store.js'

export { RoomHub } from './room-hub.js'

export default {
  fetch(request, env, ctx) {
    return app.fetch(request, env, ctx)
  },

  scheduled(controller, env, ctx) {
    const scheduledAt = new Date(controller.scheduledTime)
    const supabase = createSupabaseClient(supabaseConfigFromEnv(env))

    if (controller.cron === '0 4 * * *') {
      ctx.waitUntil(syncCurrentCycleRooms(supabase, { now: scheduledAt }).then((result) => {
        console.log('Daily room sync completed', {
          cron: controller.cron,
          scheduledAt: scheduledAt.toISOString(),
          matched: result.matched,
          upserted: result.upserted,
        })
      }))
      return
    }

    ctx.waitUntil(syncLiveRoomScores(supabase, { now: scheduledAt }).then((result) => {
      console.log('Live score sync completed', {
        cron: controller.cron,
        scheduledAt: scheduledAt.toISOString(),
        checked: result.checked,
        candidateRooms: result.candidateRooms,
        scorelines: result.scorelines,
        updated: result.updated,
        reason: result.reason,
      })
    }))
  },
} satisfies ExportedHandler<Env>
