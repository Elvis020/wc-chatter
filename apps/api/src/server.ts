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
type AppContext = Context<{ Bindings: RuntimeEnv }>
type RoomMutationConfig<TPayload> = {
  parse: (input: unknown) => TPayload
  rateLimit: {
    userId: (payload: TPayload) => string
    action: string
  }
  mutate: (store: ApiStore, payload: TPayload) => Promise<Room | null> | Room | null
  notFoundMessage: string
}

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

function getRoom(store: ApiStore, roomId: string) {
  return Promise.resolve(store.getRoom(roomId))
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

async function handleApiError(c: AppContext, error: unknown) {
  const response = errorResponse(error)
  return c.json(response.body, response.status)
}

async function runRoomMutation<TPayload>(c: AppContext, config: RoomMutationConfig<TPayload>) {
  const store = storeFor(c.env)

  try {
    const payload = config.parse(await readJson(c))
    enforceMutationRateLimit(config.rateLimit.userId(payload), config.rateLimit.action)
    const room = await config.mutate(store, payload)

    if (!room) {
      throw new ApiError('NOT_FOUND', config.notFoundMessage, 404)
    }

    const event: ApiEvent = { type: 'room.updated', room }
    await broadcastRoom(c.env, store, event)
    return c.json({ room })
  } catch (error) {
    return handleApiError(c, error)
  }
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
    return handleApiError(c, error)
  }
})

app.get('/api/rooms/:roomId', async (c) => {
  const store = storeFor(c.env)
  try {
    const room = await getRoom(store, c.req.param('roomId'))

    if (!room) {
      throw new ApiError('NOT_FOUND', 'Room not found.', 404)
    }

    return c.json({ room })
  } catch (error) {
    return handleApiError(c, error)
  }
})

app.post('/api/rooms/:roomId/predictions', async (c) => {
  const roomId = c.req.param('roomId')
  return runRoomMutation(c, {
    parse: parsePredictionInput,
    rateLimit: { userId: (payload) => payload.authorId, action: 'prediction' },
    mutate: (store, payload) => store.addPrediction(roomId, payload),
    notFoundMessage: 'Room not found.',
  })
})

app.post('/api/predictions/:predictionId/likes', async (c) => {
  const predictionId = c.req.param('predictionId')
  return runRoomMutation(c, {
    parse: parseLikeInput,
    rateLimit: { userId: (payload) => payload.userId, action: 'like' },
    mutate: (store, payload) => store.setPredictionLike(predictionId, payload.userId, payload.liked),
    notFoundMessage: 'Prediction not found.',
  })
})

app.post('/api/predictions/:predictionId/edit', async (c) => {
  const predictionId = c.req.param('predictionId')
  return runRoomMutation(c, {
    parse: parsePredictionEditInput,
    rateLimit: { userId: (payload) => payload.userId, action: 'edit' },
    mutate: (store, payload) => store.updatePredictionText(predictionId, payload),
    notFoundMessage: 'Prediction not found.',
  })
})

app.post('/api/comments/:commentId/replies', async (c) => {
  const commentId = c.req.param('commentId')
  return runRoomMutation(c, {
    parse: parseReplyInput,
    rateLimit: { userId: (payload) => payload.authorId, action: 'reply' },
    mutate: (store, payload) => store.addReply(commentId, payload),
    notFoundMessage: 'Comment not found.',
  })
})

app.post('/api/predictions/:predictionId/comments', async (c) => {
  const predictionId = c.req.param('predictionId')
  return runRoomMutation(c, {
    parse: parsePredictionCommentInput,
    rateLimit: { userId: (payload) => payload.authorId, action: 'reply' },
    mutate: (store, payload) => store.addPredictionComment(predictionId, payload),
    notFoundMessage: 'Prediction not found.',
  })
})

app.post('/api/replies/:replyId/edit', async (c) => {
  const replyId = c.req.param('replyId')
  return runRoomMutation(c, {
    parse: parseReplyEditInput,
    rateLimit: { userId: (payload) => payload.userId, action: 'edit' },
    mutate: (store, payload) => store.updateReply(replyId, payload),
    notFoundMessage: 'Reply not found.',
  })
})

app.get('/api/admin/prize-claims', async (c) => {
  const store = storeFor(c.env)
  try {
    return c.json({ entries: await store.getPrizeDeskEntries() })
  } catch (error) {
    return handleApiError(c, error)
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
