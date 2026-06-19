import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  CONTENT_EDIT_WINDOW_MS,
  loadFixtures,
  matchStatusFromKickoff,
  matchKickoffUtc,
  mockThemes,
  type ApiEvent,
  type CreatePredictionInput,
  type Prediction,
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
} from '@wc-chatter/shared'
import { ApiError } from './errors.js'

type WebSocketLike = {
  send: (data: string) => void
  readyState?: number
}

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
const ROOM_STATUS_ORDER: Record<RoomRow['status'], number> = {
  live: 0,
  draft: 1,
  closed: 2,
  archived: 3,
}
const ROOM_SELECT =
  'id, slug, title, home_name, home_code, home_iso2, home_flag, away_name, away_code, away_iso2, away_flag, status, match_status, room_status, is_featured, current_home_score, current_away_score, score_status, score_clock, score_provider, score_updated_at, event_date, kickoff_at, created_at'
const ROOM_STATE_SELECT =
  'id, slug, title, home_name, home_code, home_iso2, home_flag, away_name, away_code, away_iso2, away_flag, status, match_status, room_status, is_featured, event_date, kickoff_at, created_at'
const LEGACY_ROOM_SELECT =
  'id, slug, title, home_name, home_code, home_iso2, home_flag, away_name, away_code, away_iso2, away_flag, status, event_date, created_at'
const SUPABASE_IN_BATCH_SIZE = 100
const fixtureKickoffs = new Map(
  loadFixtures().flatMap((match) => {
    const kickoff = matchKickoffUtc(match)
    return [
      [match.id, kickoff],
      [`${match.home.code}-${match.away.code}`, kickoff],
    ]
  }),
)

type PredictionOwnerRow = {
  id: string
  room_id: string
  author_id: string
  created_at: string
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

function toTeam(name: string, code: string, iso2?: string | null, flag?: string | null): Team {
  return {
    name,
    code,
    iso2: iso2 ?? '',
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

function formatMargin(homeName: string, awayName: string, homeScore: number, awayScore: number) {
  if (homeScore === awayScore) return 'Draw backed most'
  const side = homeScore > awayScore ? homeName : awayName
  const gap = Math.abs(homeScore - awayScore)
  return `${side} by ${gap}`
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

function mostBackedFor(room: RoomRow, predictions: Prediction[]) {
  if (predictions.length === 0) {
    return {
      home: 0,
      away: 0,
      margin: 'No picks yet',
    }
  }

  const backed = new Map<string, { home: number; away: number; count: number; likes: number; createdAt: string }>()
  for (const prediction of predictions) {
    const key = `${prediction.homeScore}-${prediction.awayScore}`
    const existing = backed.get(key)
    if (existing) {
      existing.count += 1
      existing.likes += prediction.likes
      if (prediction.createdAt > existing.createdAt) existing.createdAt = prediction.createdAt
      continue
    }

    backed.set(key, {
      home: prediction.homeScore,
      away: prediction.awayScore,
      count: 1,
      likes: prediction.likes,
      createdAt: prediction.createdAt,
    })
  }

  const top = [...backed.values()].sort(
    (left, right) => right.count - left.count || right.likes - left.likes || right.createdAt.localeCompare(left.createdAt),
  )[0]

  return {
    home: top.home,
    away: top.away,
    margin: formatMargin(room.home_name, room.away_name, top.home, top.away),
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
    mostBacked: mostBackedFor(room, predictions),
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
        text: comment.text,
        replies: repliesByComment.get(comment.id) ?? [],
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

export function createSupabaseStore(config: SupabaseStoreConfig) {
  const supabase = createSupabaseClient(config)
  const clients = new Map<string, WebSocketLike>()

  async function getRoomRows() {
    let response: any = await supabase
      .from('rooms')
      .select(ROOM_SELECT)
      .order('event_date', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false })

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
        .select(ROOM_STATE_SELECT)
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
    if (predictionIds.length === 0) return []
    const rows: LikeRow[] = []

    for (const batch of chunks(predictionIds, SUPABASE_IN_BATCH_SIZE)) {
      const { data, error } = await supabase
        .from('prediction_likes')
        .select('prediction_id, user_id')
        .in('prediction_id', batch)

      if (error) {
        logSupabaseError('getLikes', error)
        throw new ApiError('INTERNAL_ERROR', 'Unable to load likes.', 500)
      }

      rows.push(...((data ?? []) as LikeRow[]))
    }

    return rows
  }

  async function getComments(predictionIds: string[]) {
    if (predictionIds.length === 0) return []
    const rows: CommentRow[] = []

    for (const batch of chunks(predictionIds, SUPABASE_IN_BATCH_SIZE)) {
      const { data, error } = await supabase
        .from('comments')
        .select('id, prediction_id, author_id, author_name, text, created_at, edited_at')
        .in('prediction_id', batch)
        .eq('hidden', false)
        .order('created_at', { ascending: true })

      if (error) {
        logSupabaseError('getComments', error)
        throw new ApiError('INTERNAL_ERROR', 'Unable to load comments.', 500)
      }

      rows.push(...((data ?? []) as CommentRow[]))
    }

    return rows
  }

  async function getReplies(commentIds: string[]) {
    if (commentIds.length === 0) return []
    const rows: ReplyRow[] = []

    for (const batch of chunks(commentIds, SUPABASE_IN_BATCH_SIZE)) {
      const { data, error } = await supabase
        .from('comment_replies')
        .select('id, comment_id, author_id, author_name, text, created_at, edited_at')
        .in('comment_id', batch)
        .eq('hidden', false)
        .order('created_at', { ascending: true })

      if (error) {
        logSupabaseError('getReplies', error)
        throw new ApiError('INTERNAL_ERROR', 'Unable to load replies.', 500)
      }

      rows.push(...((data ?? []) as ReplyRow[]))
    }

    return rows
  }

  async function hydrateRooms(roomRows: RoomRow[]) {
    const predictions = await getPredictions(roomRows.map((room) => room.id))
    const predictionIds = predictions.map((prediction) => prediction.id)
    const [likes, comments] = await Promise.all([getLikes(predictionIds), getComments(predictionIds)])
    const replies = await getReplies(comments.map((comment) => comment.id))
    const predictionsByRoom = mapPredictions(predictions, likes, comments, replies)
    return roomRows.map((room) => mapRoom(room, predictionsByRoom))
  }

  async function hydrateRoom(roomRef: string) {
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

  function assertEditable(createdAt: string) {
    if (Date.now() - Date.parse(createdAt) > CONTENT_EDIT_WINDOW_MS) {
      throw new ApiError('FORBIDDEN', 'The edit window has closed.', 403)
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

      const take = payload.comment?.trim() || 'Fresh from the confidence department.'
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

      const { error: commentError } = await supabase.from('comments').insert({
        prediction_id: prediction.id,
        author_id: payload.authorId,
        author_name: payload.name,
        text: take,
      })

      if (commentError) throw new ApiError('INTERNAL_ERROR', 'Unable to create prediction comment.', 500)
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

      return hydrateRoom(prediction.room_id)
    },
    async updatePredictionText(predictionId: string, payload: UpdatePredictionInput) {
      const prediction = await getPredictionOwner(predictionId)
      if (!prediction) return null
      if (prediction.author_id !== payload.userId) {
        throw new ApiError('FORBIDDEN', 'You can only edit your own prediction.', 403)
      }
      assertEditable(prediction.created_at)

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

      return hydrateRoom(prediction.room_id)
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
      assertEditable(replyRow.created_at)

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
      return hydrateRoom(roomId)
    },
  }
}
