import { randomUUID } from 'node:crypto'

type Room = {
  id: string
  matchStatus: 'upcoming' | 'live' | 'finished'
  roomStatus: 'open' | 'closed' | 'hidden'
  home: { code: string }
  away: { code: string }
  predictions: Array<{
    id: string
    authorId?: string
    comments: Array<{ id: string }>
  }>
}

type BootstrapResponse = {
  rooms: Room[]
}

type MutationResult<T> = {
  ok: boolean
  status: number
  ms: number
  body?: T
  error?: string
}

const apiBaseUrl = process.env.LOAD_TEST_API_URL ?? 'http://localhost:8787'
const wsBaseUrl = process.env.LOAD_TEST_WS_URL ?? apiBaseUrl.replace(/^http/, 'ws') + '/ws'
const userCount = Number(process.env.LOAD_TEST_USERS ?? 100)
const socketCount = Number(process.env.LOAD_TEST_SOCKETS ?? userCount)
const scenario = process.env.LOAD_TEST_SCENARIO ?? 'balanced'
const audienceMix = process.env.LOAD_TEST_AUDIENCE_MIX ?? 'GH:70,UK:10,US:10,IE:10'
const requestTimeoutMs = Number(process.env.LOAD_TEST_REQUEST_TIMEOUT_MS ?? 30_000)
const runId = randomUUID().slice(0, 8)

function parseAudienceMix(value: string) {
  const entries = value
    .split(',')
    .map((entry) => {
      const [region, weightText] = entry.split(':')
      const weight = Number(weightText)
      return { region: region?.trim().toUpperCase(), weight: Number.isFinite(weight) && weight > 0 ? weight : 0 }
    })
    .filter((entry) => entry.region && entry.weight > 0)

  return entries.length > 0 ? entries : [{ region: 'GH', weight: 100 }]
}

function regionForIndex(index: number, mix: Array<{ region: string; weight: number }>) {
  const total = mix.reduce((sum, entry) => sum + entry.weight, 0)
  const cursor = ((index % total) + 1)
  let running = 0

  for (const entry of mix) {
    running += entry.weight
    if (cursor <= running) return entry.region
  }

  return mix[0].region
}

function percentile(values: number[], p: number) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]
}

function summarize(label: string, results: MutationResult<unknown>[]) {
  const ok = results.filter((result) => result.ok)
  const failed = results.filter((result) => !result.ok)
  const latencies = ok.map((result) => result.ms)

  console.log(`${label}: ${ok.length}/${results.length} ok`)
  console.log(
    `${label} latency: p50=${percentile(latencies, 50)}ms p90=${percentile(latencies, 90)}ms p99=${percentile(latencies, 99)}ms max=${Math.max(0, ...latencies)}ms`,
  )

  if (failed.length > 0) {
    const grouped = new Map<string, number>()
    for (const result of failed) {
      const key = `${result.status} ${result.error ?? 'unknown'}`
      grouped.set(key, (grouped.get(key) ?? 0) + 1)
    }
    console.log(`${label} errors:`)
    for (const [error, count] of grouped.entries()) {
      console.log(`  ${count}x ${error}`)
    }
  }
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<MutationResult<T>> {
  const startedAt = Date.now()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs)

  try {
    const response = await fetch(`${apiBaseUrl}${path}`, {
      ...init,
      signal: controller.signal,
    })
    const text = await response.text()
    let body: any
    try {
      body = text ? JSON.parse(text) : undefined
    } catch {
      body = undefined
    }

    return {
      ok: response.ok,
      status: response.status,
      ms: Date.now() - startedAt,
      body,
      error: response.ok ? undefined : (body?.error?.message ?? (text || response.statusText)),
    }
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError'
    return {
      ok: false,
      status: 0,
      ms: Date.now() - startedAt,
      error: aborted ? `Request timed out after ${requestTimeoutMs}ms` : error instanceof Error ? error.message : 'Request failed',
    }
  } finally {
    clearTimeout(timeout)
  }
}

async function openSocket(roomId: string) {
  return new Promise<{ socket: WebSocket; messages: () => number }>((resolve, reject) => {
    let messageCount = 0
    const socket = new WebSocket(`${wsBaseUrl}/${roomId}`)
    const timeout = setTimeout(() => {
      socket.close()
      reject(new Error('WebSocket connection timed out'))
    }, 8_000)

    socket.addEventListener('open', () => {
      clearTimeout(timeout)
      resolve({ socket, messages: () => messageCount })
    })
    socket.addEventListener('message', () => {
      messageCount += 1
    })
    socket.addEventListener('error', () => {
      clearTimeout(timeout)
      reject(new Error('WebSocket connection failed'))
    })
  })
}

const bootstrap = await requestJson<BootstrapResponse>('/api/bootstrap')
if (!bootstrap.ok || !bootstrap.body) {
  console.error(`Unable to bootstrap rooms: ${bootstrap.status} ${bootstrap.error ?? ''}`)
  process.exit(1)
}

const room = bootstrap.body.rooms.find((candidate) => candidate.roomStatus === 'open' && candidate.matchStatus !== 'finished')
if (!room) {
  console.error('No open upcoming/live room available for load test.')
  process.exit(1)
}

console.log(`Load test target: ${apiBaseUrl}`)
console.log(`Room: ${room.home.code}-${room.away.code} (${room.id})`)
console.log(`Users: ${userCount}`)
console.log(`WebSocket users: ${socketCount}`)
console.log(`Scenario: ${scenario}`)
console.log(`Audience mix: ${audienceMix}`)
console.log(`HTTP request timeout: ${requestTimeoutMs}ms`)

const sockets = await Promise.allSettled(Array.from({ length: socketCount }, () => openSocket(room.id)))
const openSockets = sockets.filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof openSocket>>> => result.status === 'fulfilled').map((result) => result.value)
console.log(`WebSockets: ${openSockets.length}/${sockets.length} connected`)

const parsedAudienceMix = parseAudienceMix(audienceMix)
const users = Array.from({ length: userCount }, (_, index) => ({
  id: `user-${randomUUID()}`,
  region: regionForIndex(index, parsedAudienceMix),
  name: `Load ${String(index + 1).padStart(3, '0')}`,
}))

if (scenario === 'reply-hotspot') {
  const [seedUser] = users
  if (!seedUser) {
    console.error('No users available for reply hotspot test.')
    process.exit(1)
  }

  const seedPredictionResults = [
    await requestJson<{ room: Room }>(`/api/rooms/${room.id}/predictions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        authorId: seedUser.id,
        name: seedUser.name,
        homeScore: 2,
        awayScore: 1,
        comment: `[${seedUser.region}] Hotspot seed ${runId}`,
      }),
    }),
  ]
  summarize('Seed prediction', seedPredictionResults)

  const hotspotPrediction = seedPredictionResults[0].body?.room?.predictions.find((prediction) => prediction.authorId === seedUser.id)
  const hotspotComment = hotspotPrediction?.comments[0]
  if (!hotspotComment) {
    console.error('Unable to create hotspot prediction/comment; skipping replies.')
    for (const { socket } of openSockets) {
      socket.close()
    }
    process.exit(1)
  }

  console.log(`Sending ${users.length} hotspot replies...`)
  const hotspotReplyResults = await Promise.all(
    users.map((user, index) =>
      requestJson(`/api/comments/${hotspotComment.id}/replies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          authorId: user.id,
          name: user.name,
          text: `[${user.region}] Hotspot reply ${runId} ${index + 1}`,
        }),
      }),
    ),
  )
  summarize('Hotspot replies', hotspotReplyResults)

  await new Promise((resolve) => setTimeout(resolve, 1_000))
  const socketMessages = openSockets.map((socket) => socket.messages())
  const minSocketMessages = socketMessages.length > 0 ? Math.min(...socketMessages) : 0
  console.log(`WebSocket messages: min=${minSocketMessages} max=${Math.max(0, ...socketMessages)} total=${socketMessages.reduce((sum, count) => sum + count, 0)}`)

  for (const { socket } of openSockets) {
    socket.close()
  }
  process.exit(0)
}

console.log(`Sending ${users.length} predictions...`)
const predictionResults = await Promise.all(
  users.map((user, index) =>
    requestJson<{ room: Room }>(`/api/rooms/${room.id}/predictions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        authorId: user.id,
        name: user.name,
        homeScore: index % 5,
        awayScore: (index + 2) % 4,
        comment: `[${user.region}] Load test ${runId} message ${index + 1}`,
      }),
    }),
  ),
)
summarize('Predictions', predictionResults)

const createdPredictions = predictionResults
  .map((result, index) => result.body?.room?.predictions.find((prediction) => prediction.authorId === users[index].id))
  .filter((prediction): prediction is NonNullable<typeof prediction> => !!prediction)

if (createdPredictions.length === 0) {
  console.error('No predictions were created; skipping likes and replies.')
  for (const { socket } of openSockets) {
    socket.close()
  }
  process.exit(1)
}

console.log(`Sending ${users.length} likes...`)
const likeResults = await Promise.all(
  users.map((user, index) => {
    const target = createdPredictions[(index + 1) % createdPredictions.length]
    if (!target) {
      return Promise.resolve({ ok: false, status: 0, ms: 0, error: 'No created prediction target' })
    }

    return requestJson(`/api/predictions/${target.id}/likes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: user.id, liked: true }),
    })
  }),
)
summarize('Likes', likeResults)

const replyTargets = createdPredictions
  .map((prediction) => prediction.comments[0])
  .filter((comment): comment is { id: string } => !!comment)

if (replyTargets.length === 0) {
  console.error('No comments were created; skipping replies.')
  for (const { socket } of openSockets) {
    socket.close()
  }
  process.exit(1)
}

console.log(`Sending ${users.length} replies...`)
const replyResults = await Promise.all(
  users.map((user, index) => {
    const target = replyTargets[index % replyTargets.length]
    if (!target) {
      return Promise.resolve({ ok: false, status: 0, ms: 0, error: 'No reply target' })
    }

    return requestJson(`/api/comments/${target.id}/replies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        authorId: user.id,
        name: user.name,
        text: `[${user.region}] Load reply ${runId} ${index + 1}`,
      }),
    })
  }),
)
summarize('Replies', replyResults)

await new Promise((resolve) => setTimeout(resolve, 1_000))
const socketMessages = openSockets.map((socket) => socket.messages())
const minSocketMessages = socketMessages.length > 0 ? Math.min(...socketMessages) : 0
console.log(`WebSocket messages: min=${minSocketMessages} max=${Math.max(0, ...socketMessages)} total=${socketMessages.reduce((sum, count) => sum + count, 0)}`)

for (const { socket } of openSockets) {
  socket.close()
}
