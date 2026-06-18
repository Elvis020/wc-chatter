import { app } from './server.js'
export { RoomHub } from './room-hub.js'

export default {
  fetch(request, env, ctx) {
    return app.fetch(request, env, ctx)
  },
} satisfies ExportedHandler<Env>
