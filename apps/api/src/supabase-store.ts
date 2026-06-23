import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  buildMostBackedSummary,
  createFixtureKickoffLookup,
  matchStatusFromKickoff,
  seededResultForFixture,
  mockThemes,
  prizeResultForScore,
  subdivisionFlagIso2,
  type ApiEvent,
  type CreatePredictionInput,
  type PredictionCommentInput,
  type Prediction,
  type PrizeDeskEntry,
  type Reply,
  type ReplyInput,
  type Room,
  type RoomCurrentScore,
  type RoomScoreStatus,
  type MatchStatus,
  type RoomInteractionStatus,
  type RoomStatus,
  type Team,
  type ThemeOption,
  type UpdatePredictionInput,
  type UpdateReplyInput,
} from '@turntabl-score-room/shared'
import { ApiError } from './errors.js'
import type { RoomStore, WebSocketLike } from './store-contract.js'

type RoomRow = {
  id: string
  slug: string
  title: string
  home_name: string
  home_code: string
  home_iso2: string | null
  home_flag: string | null
  away_name: string
  away_code: string
  away_iso2: string | null
  away_flag: string | null
  status: 'draft' | 'live' | 'closed' | 'archived'
  match_status?: MatchStatus | null
  room_status?: RoomInteractionStatus | null
  is_featured?: boolean | null
  current_home_score?: number | null
  current_away_score?: number | null
  score_status?: RoomScoreStatus | null
  score_clock?: string | null
  score_provider?: string | null
  score_updated_at?: string | null
  event_date: string | null
  kickoff_at?: string | null
  created_at: string
}

type PredictionRow = {
  id: string
  room_id: string
  author_id: string
  author_name: string
  home_score: number
  away_score: number
  take: string | null
  created_at: string
  edited_at?: string | null
}

type LikeRow = {
  prediction_id: string
  user_id: string
}

type CommentRow = {
  id: string
  prediction_id: string
  author_id: string
  author_name: string
  text: string
  created_at: string
  edited_at?: string | null
}

type ReplyRow = {
  id: string
  comment_id: string
  author_id: string
  author_name: string
  text: string
  created_at: string
  edited_at?: string | null
}

export type SupabaseStoreConfig = {
  url: string
  serviceRoleKey: string
}

export type SupabaseEnv = {
  SUPABASE_URL?: string
  SUPABASE_SERVICE_ROLE_KEY?: string
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const ROOM_WRITE_STATUSES = new Set<RoomInteractionStatus>(['open'])
const ROOM_CACHE_TTL_MS = 2_000
const ROOM_STATUS_ORDER: Record<RoomRow['status'], number> = {
  live: 0,
  draft: 1,
  closed: 2,
  archived: 3,
}
const ROOM_SELECT =
  'id, slug, title, home_name, home_code, home_iso2, home_flag, away_name, away_code, away_iso2, away_flag, status, match_status, room_status, is_featured, current_home_score, current_away_score, score_status, score_clock, score_provider, score_updated_at, event_date, kickoff_at, created_at'
const ROOM_SCORE_SELECT =
  'id, slug, title, home_name, home_code, home_iso2, home_flag, away_name, away_code, away_iso2, away_flag, status, match_status, room_status, is_featured, current_home_score, current_away_score, score_status, score_clock, score_provider, score_updated_at, event_date, created_at'
const ROOM_STATE_SELECT =
  'id, slug, title, home_name, home_code, home_iso2, home_flag, away_name, away_code, away_iso2, away_flag, status, match_status, room_status, is_featured, event_date, kickoff_at, created_at'
const ROOM_STATE_NO_KICKOFF_SELECT =
  'id, slug, title, home_name, home_code, home_iso2, home_flag, away_name, away_code, away_iso2, away_flag, status, match_status, room_status, is_featured, event_date, created_at'
const LEGACY_ROOM_SELECT =
  'id, slug, title, home_name, home_code, home_iso2, home_flag, away_name, away_code, away_iso2, away_flag, status, event_date, created_at'
const SUPABASE_IN_BATCH_SIZE = 100
const fixtureKickoffs = createFixtureKickoffLookup()

type PredictionOwnerRow = {
  id: string
  room_id: string
  author_id: string
  created_at: string
}

type PrizeClaimRow = {
  id: string
  room_id: string
  prediction_id: string
  author_id: string
  author_name: string
  question: string
  answer: string
  created_at: string
}

function isMissingRelationError(error?: { code?: string; message?: string } | null) {
  return error?.code === 'PGRST205' || error?.code === '42P01' || error?.message?.toLowerCase().includes('could not find the table')
}

function isMissingColumnError(error?: { code?: string } | null) {
  return error?.code === 'PGRST204' || error?.code === '42703'
}

function chunks<T>(items: T[], size: number) {
  const result: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size))
  }
  return result
}

async function loadInBatches<T>(
  ids: string[],
  label: string,
  loadBatch: (ids: string[]) => Promise<{ data: T[] | null; error: { code?: string; message?: string; details?: string; hint?: string } | null }>,
) {
  if (ids.length === 0) return []

  const responses = await Promise.all(chunks(ids, SUPABASE_IN_BATCH_SIZE).map((batch) => loadBatch(batch)))
  const rows: T[] = []

  for (const response of responses) {
    if (response.error) {
      logSupabaseError(label, response.error)
      throw new ApiError('INTERNAL_ERROR', `Unable to load ${label}.`, 500)
    }
    rows.push(...(response.data ?? []))
  }

  return rows
}

function toTeam(name: string, code: string, iso2?: string | null, flag?: string | null): Team {
  return {
    name,
    code,
    iso2: iso2 || subdivisionFlagIso2(name, code),
    flag: flag ?? '',
  }
}

function toRoomStatus(status: RoomRow['status']): RoomStatus {
  if (status === 'live') return 'live'
  if (status === 'closed' || status === 'archived') return 'archived'
  return 'upcoming'
}

function legacyMatchStatus(status: RoomRow['status']): MatchStatus {
  if (status === 'live') return 'live'
  if (status === 'closed' || status === 'archived') return 'finished'
  return 'upcoming'
}

function kickoffForRoom(room: RoomRow) {
  return room.kickoff_at ?? fixtureKickoffs.get(room.slug) ?? fixtureKickoffs.get(`${room.home_code}-${room.away_code}`) ?? null
}

function effectiveMatchStatus(room: RoomRow): MatchStatus {
  if (room.match_status === 'finished') return 'finished'

  const timedStatus = matchStatusFromKickoff(kickoffForRoom(room))
  if (timedStatus) return timedStatus

  return room.match_status ?? legacyMatchStatus(room.status)
}

function effectiveRoomStatus(room: RoomRow): RoomStatus {
  const matchStatus = effectiveMatchStatus(room)
  if (matchStatus === 'finished') return 'archived'
  if (matchStatus === 'live') return 'live'
  return toRoomStatus(room.status)
}

function legacyRoomStatus(status: RoomRow['status']): RoomInteractionStatus {
  if (status === 'closed' || status === 'archived') return 'closed'
  return 'open'
}

function currentScoreForRoom(room: RoomRow): RoomCurrentScore | undefined {
  if (
    room.current_home_score === undefined ||
    room.current_home_score === null ||
    room.current_away_score === undefined ||
    room.current_away_score === null ||
    !room.score_status ||
    !room.score_updated_at
  ) {
    return undefined
  }

  return {
    home: room.current_home_score,
    away: room.current_away_score,
    status: room.score_status,
    clock: room.score_clock ?? '',
    provider: room.score_provider ?? '',
    updatedAt: room.score_updated_at,
  }
}

function actualScoreForRoom(room: RoomRow): RoomCurrentScore | undefined {
  const syncedScore = currentScoreForRoom(room)
  if (syncedScore) return syncedScore

  if (matchStatusFromKickoff(kickoffForRoom(room)) !== 'finished') return undefined

  const eventDate = room.event_date
  if (!eventDate) return undefined

  const seed = seededResultForFixture(eventDate, room.home_name, room.away_name)
  if (!seed) return undefined

  return {
    home: seed.homeGoals,
    away: seed.awayGoals,
    status: 'finished',
    clock: 'FT',
    provider: 'wc-idea seed',
    updatedAt: room.kickoff_at ?? eventDate,
  }
}

function prizeResultFor(room: RoomRow | undefined, prediction: PredictionRow): PrizeDeskEntry['result'] {
  const score = room ? actualScoreForRoom(room) : undefined
  return prizeResultForScore({ homeScore: prediction.home_score, awayScore: prediction.away_score }, score)
}

function mapPrizeDeskEntry(
  prediction: PredictionRow,
  room: RoomRow | undefined,
  claim: PrizeClaimRow | undefined,
): PrizeDeskEntry {
  return {
    id: prediction.id,
    roomId: room?.slug ?? prediction.room_id,
    roomTitle: room?.title ?? 'Unknown room',
    matchStatus: room ? effectiveMatchStatus(room) : 'upcoming',
    home: room ? toTeam(room.home_name, room.home_code, room.home_iso2, room.home_flag) : toTeam('Home', 'HOME'),
    away: room ? toTeam(room.away_name, room.away_code, room.away_iso2, room.away_flag) : toTeam('Away', 'AWAY'),
    finalScore: room ? actualScoreForRoom(room) : undefined,
    predictionId: prediction.id,
    authorId: prediction.author_id,
    authorName: prediction.author_name,
    predictedHomeScore: prediction.home_score,
    predictedAwayScore: prediction.away_score,
    createdAt: prediction.created_at,
    result: prizeResultFor(room, prediction),
    pickup: claim
      ? {
          claimId: claim.id,
          question: claim.question,
          answer: claim.answer,
          createdAt: claim.created_at,
        }
      : undefined,
  }
}

function mapRoom(
  room: RoomRow,
  predictionsByRoom: Map<string, Prediction[]>,
): Room {
  const predictions = predictionsByRoom.get(room.id) ?? []
  const matchStatus = effectiveMatchStatus(room)
  const kickoffAt = kickoffForRoom(room) ?? undefined

  return {
    id: room.id,
    status: effectiveRoomStatus(room),
    matchStatus,
    roomStatus: room.room_status ?? legacyRoomStatus(room.status),
    kickoffAt,
    isFeatured: matchStatus === 'live',
    currentScore: currentScoreForRoom(room),
    home: toTeam(room.home_name, room.home_code, room.home_iso2, room.home_flag),
    away: toTeam(room.away_name, room.away_code, room.away_iso2, room.away_flag),
    mostBacked: buildMostBackedSummary(
      { homeName: room.home_name, awayName: room.away_name },
      predictions,
    ),
    predictions,
  }
}

export function mapPredictions(
  predictions: PredictionRow[],
  likes: LikeRow[],
  comments: CommentRow[],
  replies: ReplyRow[],
) {
  const likesByPrediction = new Map<string, number>()
  const commentsByPrediction = new Map<string, CommentRow[]>()
  const repliesByComment = new Map<string, Reply[]>()

  for (const like of likes) {
    likesByPrediction.set(like.prediction_id, (likesByPrediction.get(like.prediction_id) ?? 0) + 1)
  }

  for (const reply of replies) {
    const nextReply: Reply = {
      id: reply.id,
      authorId: reply.author_id,
      name: reply.author_name,
      text: reply.text,
      createdAt: reply.created_at,
    }
    if (reply.edited_at) nextReply.editedAt = reply.edited_at
    repliesByComment.set(reply.comment_id, [...(repliesByComment.get(reply.comment_id) ?? []), nextReply])
  }

  for (const comment of comments) {
    commentsByPrediction.set(comment.prediction_id, [...(commentsByPrediction.get(comment.prediction_id) ?? []), comment])
  }

  const byRoom = new Map<string, Prediction[]>()
  for (const prediction of predictions) {
    const nextPrediction: Prediction = {
      id: prediction.id,
      authorId: prediction.author_id,
      name: prediction.author_name,
      homeScore: prediction.home_score,
      awayScore: prediction.away_score,
      likes: likesByPrediction.get(prediction.id) ?? 0,
      createdAt: prediction.created_at,
      comments: (commentsByPrediction.get(prediction.id) ?? []).map((comment) => ({
        id: comment.id,
        authorId: comment.author_id,
        name: comment.author_name,
        text: comment.text,
        replies: repliesByComment.get(comment.id) ?? [],
        createdAt: comment.created_at,
      })),
    }
    if (prediction.edited_at) nextPrediction.editedAt = prediction.edited_at
    for (const comment of nextPrediction.comments) {
      const row = (commentsByPrediction.get(prediction.id) ?? []).find((item) => item.id === comment.id)
      if (row?.edited_at) comment.editedAt = row.edited_at
    }

    byRoom.set(prediction.room_id, [...(byRoom.get(prediction.room_id) ?? []), nextPrediction])
  }

  return byRoom
}

export function createSupabaseClient(config: SupabaseStoreConfig) {
  return createClient(config.url, config.serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}

function logSupabaseError(operation: string, error: { code?: string; message?: string; details?: string; hint?: string }) {
  console.error('Supabase error', {
    operation,
    code: error.code,
    message: error.message,
    details: error.details,
    hint: error.hint,
  })
}

export function hasSupabaseConfig(env: SupabaseEnv = {}) {
  const processEnv: SupabaseEnv = typeof process === 'undefined' ? {} : process.env
  return !!(env.SUPABASE_URL ?? processEnv.SUPABASE_URL) && !!(env.SUPABASE_SERVICE_ROLE_KEY ?? processEnv.SUPABASE_SERVICE_ROLE_KEY)
}

export function supabaseConfigFromEnv(env: SupabaseEnv = {}): SupabaseStoreConfig {
  const processEnv: SupabaseEnv = typeof process === 'undefined' ? {} : process.env
  const url = env.SUPABASE_URL ?? processEnv.SUPABASE_URL
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY ?? processEnv.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceRoleKey) {
    throw new ApiError('INTERNAL_ERROR', 'Supabase is not configured.', 500)
  }

  return { url, serviceRoleKey }
}

export function createSupabaseStore(config: SupabaseStoreConfig): RoomStore {
  const supabase = createSupabaseClient(config)
  const clients = new Map<string, WebSocketLike>()
  const roomCache = new Map<string, { room: Room; expiresAt: number }>()

  function cacheRoom(room: Room, aliases: string[] = []) {
    const entry = { room, expiresAt: Date.now() + ROOM_CACHE_TTL_MS }
    roomCache.set(room.id, entry)
    for (const alias of aliases) roomCache.set(alias, entry)
  }

  function cachedRoom(roomRef: string) {
    const entry = roomCache.get(roomRef)
    if (!entry) return null
    if (entry.expiresAt <= Date.now()) {
      roomCache.delete(roomRef)
      return null
    }
    return entry.room
  }

  function invalidateRoom(roomRef: string) {
    roomCache.delete(roomRef)
  }

  async function getRoomRows() {
    let response: any = await supabase
      .from('rooms')
      .select(ROOM_SELECT)
      .order('event_date', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false })

    if (isMissingColumnError(response.error)) {
      response = await supabase
        .from('rooms')
        .select(ROOM_SCORE_SELECT)
        .order('event_date', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: false })
    }

    if (isMissingColumnError(response.error)) {
      response = await supabase
        .from('rooms')
        .select(ROOM_STATE_SELECT)
        .order('event_date', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: false })
    }

    if (isMissingColumnError(response.error)) {
      response = await supabase
        .from('rooms')
        .select(ROOM_STATE_NO_KICKOFF_SELECT)
        .order('event_date', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: false })
    }

    if (isMissingColumnError(response.error)) {
      response = await supabase
        .from('rooms')
        .select(LEGACY_ROOM_SELECT)
        .order('event_date', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: false })
    }

    if (response.error) {
      logSupabaseError('getRoomRows', response.error)
      throw new ApiError('INTERNAL_ERROR', 'Unable to load rooms.', 500)
    }
    return ((response.data ?? []) as RoomRow[])
      .filter((room) => (room.room_status ?? legacyRoomStatus(room.status)) !== 'hidden')
      .sort((left, right) => {
        if ((left.is_featured ? 0 : 1) !== (right.is_featured ? 0 : 1)) {
          return left.is_featured ? -1 : 1
        }
        const statusDelta = ROOM_STATUS_ORDER[left.status] - ROOM_STATUS_ORDER[right.status]
        if (statusDelta !== 0) return statusDelta
        return Date.parse(right.created_at) - Date.parse(left.created_at)
      })
  }

  async function getRoomRowsByIds(roomIds: string[]) {
    if (roomIds.length === 0) return []

    return loadInBatches<RoomRow>(roomIds, 'prize desk rooms', async (batch) => {
      let response: any = await supabase
        .from('rooms')
        .select(ROOM_SELECT)
        .in('id', batch)

      if (isMissingColumnError(response.error)) {
        response = await supabase
          .from('rooms')
          .select(ROOM_SCORE_SELECT)
          .in('id', batch)
      }

      if (isMissingColumnError(response.error)) {
        response = await supabase
          .from('rooms')
          .select(ROOM_STATE_SELECT)
          .in('id', batch)
      }

      if (isMissingColumnError(response.error)) {
        response = await supabase
          .from('rooms')
          .select(ROOM_STATE_NO_KICKOFF_SELECT)
          .in('id', batch)
      }

      if (isMissingColumnError(response.error)) {
        response = await supabase
          .from('rooms')
          .select(LEGACY_ROOM_SELECT)
          .in('id', batch)
      }

      return { data: (response.data ?? null) as RoomRow[] | null, error: response.error }
    })
  }

  async function getRoomRow(roomRef: string) {
    const column = UUID_PATTERN.test(roomRef) ? 'id' : 'slug'
    let response: any = await supabase
      .from('rooms')
      .select(ROOM_SELECT)
      .eq(column, roomRef)
      .maybeSingle()

    if (isMissingColumnError(response.error)) {
      response = await supabase
        .from('rooms')
        .select(ROOM_SCORE_SELECT)
        .eq(column, roomRef)
        .maybeSingle()
    }

    if (isMissingColumnError(response.error)) {
      response = await supabase
        .from('rooms')
        .select(ROOM_STATE_SELECT)
        .eq(column, roomRef)
        .maybeSingle()
    }

    if (isMissingColumnError(response.error)) {
      response = await supabase
        .from('rooms')
        .select(ROOM_STATE_NO_KICKOFF_SELECT)
        .eq(column, roomRef)
        .maybeSingle()
    }

    if (isMissingColumnError(response.error)) {
      response = await supabase
        .from('rooms')
        .select(LEGACY_ROOM_SELECT)
        .eq(column, roomRef)
        .maybeSingle()
    }

    if (response.error) {
      logSupabaseError('getRoomRow', response.error)
      throw new ApiError('INTERNAL_ERROR', 'Unable to load room.', 500)
    }
    return response.data as RoomRow | null
  }

  async function getPredictions(roomIds: string[]) {
    if (roomIds.length === 0) return []
    const { data, error } = await supabase
      .from('predictions')
      .select('id, room_id, author_id, author_name, home_score, away_score, take, created_at, edited_at')
      .in('room_id', roomIds)
      .order('created_at', { ascending: false })

    if (error) {
      logSupabaseError('getPredictions', error)
      throw new ApiError('INTERNAL_ERROR', 'Unable to load predictions.', 500)
    }
    return (data ?? []) as PredictionRow[]
  }

  async function getLikes(predictionIds: string[]) {
    return loadInBatches<LikeRow>(predictionIds, 'likes', async (batch) => {
      const response = await supabase
        .from('prediction_likes')
        .select('prediction_id, user_id')
        .in('prediction_id', batch)
      return { data: (response.data ?? null) as LikeRow[] | null, error: response.error }
    })
  }

  async function getComments(predictionIds: string[]) {
    return loadInBatches<CommentRow>(predictionIds, 'comments', async (batch) => {
      const response = await supabase
        .from('comments')
        .select('id, prediction_id, author_id, author_name, text, created_at, edited_at')
        .in('prediction_id', batch)
        .eq('hidden', false)
        .order('created_at', { ascending: true })
      return { data: (response.data ?? null) as CommentRow[] | null, error: response.error }
    })
  }

  async function getReplies(commentIds: string[]) {
    return loadInBatches<ReplyRow>(commentIds, 'replies', async (batch) => {
      const response = await supabase
        .from('comment_replies')
        .select('id, comment_id, author_id, author_name, text, created_at, edited_at')
        .in('comment_id', batch)
        .eq('hidden', false)
        .order('created_at', { ascending: true })
      return { data: (response.data ?? null) as ReplyRow[] | null, error: response.error }
    })
  }

  async function getPrizeClaims(predictionIds: string[]) {
    if (predictionIds.length === 0) return []

    const responses = await Promise.all(
      chunks(predictionIds, SUPABASE_IN_BATCH_SIZE).map((batch) =>
        supabase
          .from('prize_claims')
          .select('id, room_id, prediction_id, author_id, author_name, question, answer, created_at')
          .in('prediction_id', batch),
      ),
    )
    const rows: PrizeClaimRow[] = []

    for (const response of responses) {
      if (response.error && isMissingRelationError(response.error)) {
        logSupabaseError('getPrizeDeskClaimsMissing', response.error)
        return []
      }

      if (response.error) {
        logSupabaseError('getPrizeDeskClaims', response.error)
        throw new ApiError('INTERNAL_ERROR', 'Unable to load prize pickup verification.', 500)
      }

      rows.push(...((response.data ?? []) as PrizeClaimRow[]))
    }

    return rows
  }

  async function hydrateRooms(roomRows: RoomRow[]) {
    const predictions = await getPredictions(roomRows.map((room) => room.id))
    const predictionIds = predictions.map((prediction) => prediction.id)
    const [likes, comments] = await Promise.all([getLikes(predictionIds), getComments(predictionIds)])
    const replies = await getReplies(comments.map((comment) => comment.id))
    const predictionsByRoom = mapPredictions(predictions, likes, comments, replies)
    const rooms = roomRows.map((room) => mapRoom(room, predictionsByRoom))
    for (let index = 0; index < rooms.length; index += 1) {
      cacheRoom(rooms[index], [roomRows[index].slug])
    }
    return rooms
  }

  async function hydrateRoom(roomRef: string) {
    const cached = cachedRoom(roomRef)
    if (cached) return cached

    const room = await getRoomRow(roomRef)
    if (!room) return null
    const [hydrated] = await hydrateRooms([room])
    return hydrated
  }

  function assertRoomWritable(room: RoomRow) {
    if (effectiveMatchStatus(room) === 'finished' || !ROOM_WRITE_STATUSES.has(room.room_status ?? legacyRoomStatus(room.status))) {
      throw new ApiError('FORBIDDEN', 'This room is closed for edits.', 403)
    }
  }

  async function getPredictionOwner(predictionId: string) {
    const { data, error } = await supabase
      .from('predictions')
      .select('id, room_id, author_id, created_at')
      .eq('id', predictionId)
      .maybeSingle()

    if (error) throw new ApiError('INTERNAL_ERROR', 'Unable to load prediction.', 500)
    return data as PredictionOwnerRow | null
  }

  async function rollbackPredictionCreation(predictionId: string) {
    const { error: commentDeleteError } = await supabase.from('comments').delete().eq('prediction_id', predictionId)
    if (commentDeleteError) {
      logSupabaseError('rollbackPredictionComments', commentDeleteError)
    }

    const { error: predictionDeleteError } = await supabase.from('predictions').delete().eq('id', predictionId)
    if (predictionDeleteError) {
      logSupabaseError('rollbackPrediction', predictionDeleteError)
    }
  }

  return {
    async getRooms(): Promise<Room[]> {
      return hydrateRooms(await getRoomRows())
    },
    getThemes(): ThemeOption[] {
      return mockThemes
    },
    registerClient(clientId: string, ws: WebSocketLike) {
      clients.set(clientId, ws)
    },
    unregisterClient(clientId: string) {
      clients.delete(clientId)
    },
    broadcast(event: ApiEvent) {
      const payload = JSON.stringify(event)
      for (const [clientId, ws] of clients.entries()) {
        try {
          ws.send(payload)
        } catch {
          clients.delete(clientId)
        }
      }
    },
    async getRoom(roomRef: string) {
      return hydrateRoom(roomRef)
    },
    async addPrediction(roomRef: string, payload: CreatePredictionInput) {
      const room = await getRoomRow(roomRef)
      if (!room) return null
      assertRoomWritable(room)

      const take = payload.comment?.trim() || null
      const { data: prediction, error } = await supabase
        .from('predictions')
        .insert({
          room_id: room.id,
          author_id: payload.authorId,
          author_name: payload.name,
          home_score: payload.homeScore,
          away_score: payload.awayScore,
          take,
        })
        .select('id')
        .single()

      if (error?.code === '23505') {
        throw new ApiError('CONFLICT', 'You have already posted a prediction for this room.', 409)
      }
      if (error) throw new ApiError('INTERNAL_ERROR', 'Unable to create prediction.', 500)

      if (take) {
        const { error: commentError } = await supabase.from('comments').insert({
          prediction_id: prediction.id,
          author_id: payload.authorId,
          author_name: payload.name,
          text: take,
        })

        if (commentError) {
          await rollbackPredictionCreation(prediction.id)
          throw new ApiError('INTERNAL_ERROR', 'Unable to create prediction comment.', 500)
        }
      }

      if (payload.prizeQuestion && payload.prizeAnswer) {
        const { error: claimError } = await supabase.from('prize_claims').insert({
          room_id: room.id,
          prediction_id: prediction.id,
          author_id: payload.authorId,
          author_name: payload.name,
          question: payload.prizeQuestion,
          answer: payload.prizeAnswer,
        })

        if (claimError) {
          logSupabaseError('addPredictionPrizeClaim', claimError)
          await rollbackPredictionCreation(prediction.id)
          throw new ApiError('INTERNAL_ERROR', 'Unable to save pickup verification.', 500)
        }
      }
      invalidateRoom(room.id)
      invalidateRoom(room.slug)
      return hydrateRoom(room.id)
    },
    async setPredictionLike(predictionId: string, userId: string, liked: boolean) {
      const prediction = await getPredictionOwner(predictionId)
      if (!prediction) return null

      if (liked) {
        const { error } = await supabase
          .from('prediction_likes')
          .insert({ prediction_id: predictionId, user_id: userId })

        if (error?.code !== '23505' && error) {
          throw new ApiError('INTERNAL_ERROR', 'Unable to like prediction.', 500)
        }
      } else {
        const { error } = await supabase
          .from('prediction_likes')
          .delete()
          .eq('prediction_id', predictionId)
          .eq('user_id', userId)

        if (error) throw new ApiError('INTERNAL_ERROR', 'Unable to remove like.', 500)
      }

      invalidateRoom(prediction.room_id)
      return hydrateRoom(prediction.room_id)
    },
    async updatePredictionText(predictionId: string, payload: UpdatePredictionInput) {
      const prediction = await getPredictionOwner(predictionId)
      if (!prediction) return null
      if (prediction.author_id !== payload.userId) {
        throw new ApiError('FORBIDDEN', 'You can only edit your own prediction.', 403)
      }
      const room = await getRoomRow(prediction.room_id)
      if (!room) return null
      assertRoomWritable(room)

      const editedAt = new Date().toISOString()
      const { error: predictionError } = await supabase
        .from('predictions')
        .update({ take: payload.comment, edited_at: editedAt })
        .eq('id', predictionId)

      if (predictionError) throw new ApiError('INTERNAL_ERROR', 'Unable to edit prediction.', 500)

      const { data: leadComment, error: commentLoadError } = await supabase
        .from('comments')
        .select('id')
        .eq('prediction_id', predictionId)
        .eq('author_id', payload.userId)
        .eq('hidden', false)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle()

      if (commentLoadError) throw new ApiError('INTERNAL_ERROR', 'Unable to load prediction comment.', 500)

      if (leadComment) {
        const { error: commentError } = await supabase
          .from('comments')
          .update({ text: payload.comment, edited_at: editedAt })
          .eq('id', (leadComment as { id: string }).id)

        if (commentError) throw new ApiError('INTERNAL_ERROR', 'Unable to edit prediction comment.', 500)
      }

      invalidateRoom(prediction.room_id)
      return hydrateRoom(prediction.room_id)
    },
    async addPredictionComment(predictionId: string, payload: PredictionCommentInput) {
      const prediction = await getPredictionOwner(predictionId)
      if (!prediction) return null

      const room = await getRoomRow(prediction.room_id)
      if (!room) return null
      assertRoomWritable(room)

      const text = payload.text.trim()
      if (!text) {
        throw new ApiError('VALIDATION_ERROR', 'Comment is required.', 400)
      }

      const { error } = await supabase.from('comments').insert({
        prediction_id: predictionId,
        author_id: payload.authorId,
        author_name: payload.name,
        text,
      })

      if (error) throw new ApiError('INTERNAL_ERROR', 'Unable to create prediction comment.', 500)
      invalidateRoom(prediction.room_id)
      return hydrateRoom(prediction.room_id)
    },
    async getPrizeDeskEntries() {
      const { data: predictions, error: predictionError } = await supabase
        .from('predictions')
        .select('id, room_id, author_id, author_name, home_score, away_score, take, created_at, edited_at')
        .order('created_at', { ascending: false })

      if (predictionError) {
        logSupabaseError('getPrizeDeskPredictions', predictionError)
        throw new ApiError('INTERNAL_ERROR', 'Unable to load prize desk predictions.', 500)
      }

      const predictionRows = (predictions ?? []) as PredictionRow[]
      if (predictionRows.length === 0) return []

      const roomIds = [...new Set(predictionRows.map((prediction) => prediction.room_id))]
      const predictionIds = predictionRows.map((prediction) => prediction.id)
      const [roomRows, claimRows] = await Promise.all([
        getRoomRowsByIds(roomIds),
        getPrizeClaims(predictionIds),
      ])

      const roomById = new Map(roomRows.map((room) => [room.id, room]))
      const claimByPredictionId = new Map(claimRows.map((claim) => [claim.prediction_id, claim]))
      return predictionRows
        .map((prediction) =>
          mapPrizeDeskEntry(prediction, roomById.get(prediction.room_id), claimByPredictionId.get(prediction.id)),
        )
        .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
    },
    async addReply(commentId: string, payload: ReplyInput) {
      const { data: comment, error: commentError } = await supabase
        .from('comments')
        .select('id, prediction_id')
        .eq('id', commentId)
        .maybeSingle()

      if (commentError) throw new ApiError('INTERNAL_ERROR', 'Unable to load comment.', 500)
      if (!comment) return null

      const { error } = await supabase.from('comment_replies').insert({
        comment_id: commentId,
        author_id: payload.authorId,
        author_name: payload.name,
        text: payload.text.trim(),
      })

      if (error) throw new ApiError('INTERNAL_ERROR', 'Unable to create reply.', 500)
      const prediction = await supabase
        .from('predictions')
        .select('room_id')
        .eq('id', comment.prediction_id)
        .single()

      if (prediction.error) throw new ApiError('INTERNAL_ERROR', 'Unable to load room.', 500)
      invalidateRoom(prediction.data.room_id)
      return hydrateRoom(prediction.data.room_id)
    },
    async updateReply(replyId: string, payload: UpdateReplyInput) {
      const { data: reply, error: replyError } = await supabase
        .from('comment_replies')
        .select('id, comment_id, author_id, created_at')
        .eq('id', replyId)
        .eq('hidden', false)
        .maybeSingle()

      if (replyError) throw new ApiError('INTERNAL_ERROR', 'Unable to load reply.', 500)
      if (!reply) return null

      const replyRow = reply as { id: string; comment_id: string; author_id: string; created_at: string }
      if (replyRow.author_id !== payload.userId) {
        throw new ApiError('FORBIDDEN', 'You can only edit your own reply.', 403)
      }
      const { data: comment, error: commentError } = await supabase
        .from('comments')
        .select('prediction_id')
        .eq('id', replyRow.comment_id)
        .maybeSingle()

      if (commentError) throw new ApiError('INTERNAL_ERROR', 'Unable to load comment.', 500)
      if (!comment) return null

      const { data: prediction, error: predictionError } = await supabase
        .from('predictions')
        .select('room_id')
        .eq('id', (comment as { prediction_id: string }).prediction_id)
        .maybeSingle()

      if (predictionError) throw new ApiError('INTERNAL_ERROR', 'Unable to load prediction.', 500)
      if (!prediction) return null

      const roomId = (prediction as { room_id: string }).room_id
      const room = await getRoomRow(roomId)
      if (!room) return null
      assertRoomWritable(room)

      const { error } = await supabase
        .from('comment_replies')
        .update({ text: payload.text, edited_at: new Date().toISOString() })
        .eq('id', replyId)

      if (error) throw new ApiError('INTERNAL_ERROR', 'Unable to edit reply.', 500)
      invalidateRoom(roomId)
      return hydrateRoom(roomId)
    },
  }
}
