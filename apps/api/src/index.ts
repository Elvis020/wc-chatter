import { app } from './server.js'

const port = Number(process.env.PORT ?? 8787)

export default {
  port,
  fetch: app.fetch,
}

console.log(`API listening on http://localhost:${port}`)
