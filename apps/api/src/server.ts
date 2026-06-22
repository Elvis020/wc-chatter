import { Hono, type Context } from 'hono'
import type { ApiEvent, CreatePredictionInput, PredictionCommentInput, ReplyInput, Room, ToggleLikeInput, UpdatePredictionInput, UpdateReplyInput } from '@turntabl-score-room/shared'
import { ApiError, errorResponse } from './errors.js'
import type { RoomHub } from './room-hub.js'
import { createStore } from './store.js'
import { createSupabaseStore, hasSupabaseConfig, supabaseConfigFromEnv, type SupabaseEnv } from './supabase-store.js'
import { normalizeScore, normalizeText, normalizeUserId, normalizeUsername } from './validation.js'

type RuntimeEnv = Env & SupabaseEnv
type ApiStore = ReturnType<typeof createStore> | ReturnType<typeof createSupabaseStore>
type RoomApiEvent = Extract<ApiEvent, { room: Room }>

const app = new Hono<{ Bindings: RuntimeEnv }>()
const fallbackStore = createStore()
const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX_MUTATIONS = 40
const mutationBuckets = new Map<string, { count: number; resetAt: number }>()

function storeFor(env: SupabaseEnv): ApiStore {
  return hasSupabaseConfig(env) ? createSupabaseStore(supabaseConfigFromEnv(env)) : fallbackStore
}

async function readJson(c: Context) {
  try {
    return await c.req.json()
  } catch {
    throw new ApiError('BAD_REQUEST', 'Request body must be valid JSON.', 400)
  }
}

function getRooms(store: ApiStore) {
  return Promise.resolve(store.getRooms())
}

function enforceMutationRateLimit(userId: string, action: string) {
  const now = Date.now()
  const key = `${action}:${userId}`
  const bucket = mutationBuckets.get(key)

  if (!bucket || bucket.resetAt <= now) {
    mutationBuckets.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
    return
  }

  bucket.count += 1
  if (bucket.count > RATE_LIMIT_MAX_MUTATIONS) {
    throw new ApiError('RATE_LIMITED', 'Slow down for a moment before sending more.', 429)
  }
}

function appOrigin(env: RuntimeEnv) {
  return env.APP_ORIGIN || (typeof process === 'undefined' ? '' : process.env.APP_ORIGIN) || '*'
}

async function broadcastRoom(env: RuntimeEnv, store: ApiStore, event: RoomApiEvent) {
  if (!env.ROOM_HUB) {
    store.broadcast(event)
    return
  }

  const stub = env.ROOM_HUB.getByName(event.room.id) as DurableObjectStub<RoomHub>
  await stub.broadcast(event)
}

function parsePredictionInput(input: unknown): CreatePredictionInput {
  if (!input || typeof input !== 'object') {
    throw new ApiError('BAD_REQUEST', 'Request body is required.', 400)
  }

  const body = input as Record<string, unknown>
  const prizeQuestion = normalizeText(body.prizeQuestion, 'Pickup question')
  const prizeAnswer = normalizeText(body.prizeAnswer, 'Pickup answer')
  if (prizeQuestion && prizeQuestion.length < 4) {
    throw new ApiError('VALIDATION_ERROR', 'Pickup question must be at least 4 characters.', 400)
  }
  if (prizeAnswer && prizeAnswer.length < 2) {
    throw new ApiError('VALIDATION_ERROR', 'Pickup answer must be at least 2 characters.', 400)
  }
  if (prizeQuestion && !prizeAnswer) {
    throw new ApiError('VALIDATION_ERROR', 'Pickup answer is required.', 400)
  }
  if (prizeAnswer && !prizeQuestion) {
    throw new ApiError('VALIDATION_ERROR', 'Pickup question is required.', 400)
  }

  return {
    authorId: normalizeUserId(body.authorId),
    name: normalizeUsername(body.name),
    homeScore: normalizeScore(body.homeScore, 'Home score'),
    awayScore: normalizeScore(body.awayScore, 'Away score'),
    comment: normalizeText(body.comment, 'Comment'),
    prizeQuestion,
    prizeAnswer,
  }
}

function parseLikeInput(input: unknown): ToggleLikeInput {
  if (!input || typeof input !== 'object') {
    throw new ApiError('BAD_REQUEST', 'Request body is required.', 400)
  }

  const body = input as Record<string, unknown>
  if (typeof body.liked !== 'boolean') {
    throw new ApiError('VALIDATION_ERROR', 'Liked must be true or false.', 400)
  }

  return {
    userId: normalizeUserId(body.userId),
    liked: body.liked,
  }
}

function parseReplyInput(input: unknown): ReplyInput {
  if (!input || typeof input !== 'object') {
    throw new ApiError('BAD_REQUEST', 'Request body is required.', 400)
  }

  const body = input as Record<string, unknown>
  const text = normalizeText(body.text, 'Reply')
  if (!text) {
    throw new ApiError('VALIDATION_ERROR', 'Reply is required.', 400)
  }

  return {
    authorId: normalizeUserId(body.authorId),
    name: normalizeUsername(body.name),
    text,
  }
}

function parsePredictionCommentInput(input: unknown): PredictionCommentInput {
  if (!input || typeof input !== 'object') {
    throw new ApiError('BAD_REQUEST', 'Request body is required.', 400)
  }

  const body = input as Record<string, unknown>
  const text = normalizeText(body.text, 'Comment')
  if (!text) {
    throw new ApiError('VALIDATION_ERROR', 'Comment is required.', 400)
  }

  return {
    authorId: normalizeUserId(body.authorId),
    name: normalizeUsername(body.name),
    text,
  }
}

function parsePredictionEditInput(input: unknown): UpdatePredictionInput {
  if (!input || typeof input !== 'object') {
    throw new ApiError('BAD_REQUEST', 'Request body is required.', 400)
  }

  const body = input as Record<string, unknown>
  const comment = normalizeText(body.comment, 'Comment')
  if (!comment || comment.length < 4) {
    throw new ApiError('VALIDATION_ERROR', 'Comment must be at least 4 characters.', 400)
  }

  return {
    userId: normalizeUserId(body.userId),
    comment,
  }
}

function parseReplyEditInput(input: unknown): UpdateReplyInput {
  if (!input || typeof input !== 'object') {
    throw new ApiError('BAD_REQUEST', 'Request body is required.', 400)
  }

  const body = input as Record<string, unknown>
  const text = normalizeText(body.text, 'Reply')
  if (!text) {
    throw new ApiError('VALIDATION_ERROR', 'Reply is required.', 400)
  }

  return {
    userId: normalizeUserId(body.userId),
    text,
  }
}

app.use(
  '*',
  async (c, next) => {
    const origin = c.req.header('Origin') || appOrigin(c.env)
    c.header('Access-Control-Allow-Origin', origin)
    c.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization')

    if (c.req.method === 'OPTIONS') {
      return c.body(null, 204)
    }

    await next()
  },
)

app.get('/health', (c) => c.json({ ok: true as const }))

app.get('/api/bootstrap', async (c) => {
  const store = storeFor(c.env)
  try {
    return c.json({
      rooms: await getRooms(store),
      themes: store.getThemes(),
      generatedAt: new Date().toISOString(),
    })
  } catch (error) {
    const response = errorResponse(error)
    return c.json(response.body, response.status)
  }
})

app.post('/api/rooms/:roomId/predictions', async (c) => {
  const store = storeFor(c.env)
  try {
    const roomId = c.req.param('roomId')
    const payload = parsePredictionInput(await readJson(c))
    enforceMutationRateLimit(payload.authorId, 'prediction')
    const room = await store.addPrediction(roomId, payload)

    if (!room) {
      throw new ApiError('NOT_FOUND', 'Room not found.', 404)
    }

    const event: ApiEvent = { type: 'room.updated', room }
    await broadcastRoom(c.env, store, event)
    return c.json({ room })
  } catch (error) {
    const response = errorResponse(error)
    return c.json(response.body, response.status)
  }
})

app.post('/api/predictions/:predictionId/likes', async (c) => {
  const store = storeFor(c.env)
  try {
    const predictionId = c.req.param('predictionId')
    const payload = parseLikeInput(await readJson(c))
    enforceMutationRateLimit(payload.userId, 'like')
    const room = await store.setPredictionLike(predictionId, payload.userId, payload.liked)

    if (!room) {
      throw new ApiError('NOT_FOUND', 'Prediction not found.', 404)
    }

    const event: ApiEvent = { type: 'room.updated', room }
    await broadcastRoom(c.env, store, event)
    return c.json({ room })
  } catch (error) {
    const response = errorResponse(error)
    return c.json(response.body, response.status)
  }
})

app.post('/api/predictions/:predictionId/edit', async (c) => {
  const store = storeFor(c.env)
  try {
    const predictionId = c.req.param('predictionId')
    const payload = parsePredictionEditInput(await readJson(c))
    enforceMutationRateLimit(payload.userId, 'edit')
    const room = await store.updatePredictionText(predictionId, payload)

    if (!room) {
      throw new ApiError('NOT_FOUND', 'Prediction not found.', 404)
    }

    const event: ApiEvent = { type: 'room.updated', room }
    await broadcastRoom(c.env, store, event)
    return c.json({ room })
  } catch (error) {
    const response = errorResponse(error)
    return c.json(response.body, response.status)
  }
})

app.post('/api/comments/:commentId/replies', async (c) => {
  const store = storeFor(c.env)
  try {
    const commentId = c.req.param('commentId')
    const payload = parseReplyInput(await readJson(c))
    enforceMutationRateLimit(payload.authorId, 'reply')
    const room = await store.addReply(commentId, payload)

    if (!room) {
      throw new ApiError('NOT_FOUND', 'Comment not found.', 404)
    }

    const event: ApiEvent = { type: 'room.updated', room }
    await broadcastRoom(c.env, store, event)
    return c.json({ room })
  } catch (error) {
    const response = errorResponse(error)
    return c.json(response.body, response.status)
  }
})

app.post('/api/predictions/:predictionId/comments', async (c) => {
  const store = storeFor(c.env)
  try {
    const predictionId = c.req.param('predictionId')
    const payload = parsePredictionCommentInput(await readJson(c))
    enforceMutationRateLimit(payload.authorId, 'reply')
    const room = await store.addPredictionComment(predictionId, payload)

    if (!room) {
      throw new ApiError('NOT_FOUND', 'Prediction not found.', 404)
    }

    const event: ApiEvent = { type: 'room.updated', room }
    await broadcastRoom(c.env, store, event)
    return c.json({ room })
  } catch (error) {
    const response = errorResponse(error)
    return c.json(response.body, response.status)
  }
})

app.post('/api/replies/:replyId/edit', async (c) => {
  const store = storeFor(c.env)
  try {
    const replyId = c.req.param('replyId')
    const payload = parseReplyEditInput(await readJson(c))
    enforceMutationRateLimit(payload.userId, 'edit')
    const room = await store.updateReply(replyId, payload)

    if (!room) {
      throw new ApiError('NOT_FOUND', 'Reply not found.', 404)
    }

    const event: ApiEvent = { type: 'room.updated', room }
    await broadcastRoom(c.env, store, event)
    return c.json({ room })
  } catch (error) {
    const response = errorResponse(error)
    return c.json(response.body, response.status)
  }
})

app.get('/api/admin/prize-claims', async (c) => {
  const store = storeFor(c.env)
  try {
    return c.json({ entries: await store.getPrizeDeskEntries() })
  } catch (error) {
    const response = errorResponse(error)
    return c.json(response.body, response.status)
  }
})

app.get('/ws/:roomId', async (c) => {
  const roomId = c.req.param('roomId')
  if (!envHasRoomHub(c.env)) {
    return c.json({ error: { code: 'NOT_AVAILABLE', message: 'Realtime requires the Cloudflare Worker runtime.' } }, 501)
  }

  const stub = c.env.ROOM_HUB.getByName(roomId)
  return stub.fetch(c.req.raw)
})

function envHasRoomHub(env: RuntimeEnv): env is RuntimeEnv & { ROOM_HUB: DurableObjectNamespace } {
  return !!env.ROOM_HUB
}

export { app }
