import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  mockThemes,
  type ApiEvent,
  type CreatePredictionInput,
  type Prediction,
  type Reply,
  type ReplyInput,
  type Room,
  type RoomStatus,
  type Team,
  type ThemeOption,
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
  event_date: string | null
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
}

type ReplyRow = {
  id: string
  comment_id: string
  author_id: string
  author_name: string
  text: string
  created_at: string
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
const ROOM_WRITE_STATUSES = new Set<RoomRow['status']>(['draft', 'live'])
const ROOM_STATUS_ORDER: Record<RoomRow['status'], number> = {
  live: 0,
  draft: 1,
  closed: 2,
  archived: 3,
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

function formatMargin(homeName: string, awayName: string, homeScore: number, awayScore: number) {
  if (homeScore === awayScore) return 'Draw backed most'
  const side = homeScore > awayScore ? homeName : awayName
  const gap = Math.abs(homeScore - awayScore)
  return `${side} by ${gap}`
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

  return {
    id: room.id,
    status: toRoomStatus(room.status),
    home: toTeam(room.home_name, room.home_code, room.home_iso2, room.home_flag),
    away: toTeam(room.away_name, room.away_code, room.away_iso2, room.away_flag),
    mostBacked: mostBackedFor(room, predictions),
    predictions,
  }
}

function mapPredictions(
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
    const { data, error } = await supabase
      .from('rooms')
      .select('id, slug, title, home_name, home_code, home_iso2, home_flag, away_name, away_code, away_iso2, away_flag, status, event_date, created_at')
      .order('event_date', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false })

    if (error) {
      logSupabaseError('getRoomRows', error)
      throw new ApiError('INTERNAL_ERROR', 'Unable to load rooms.', 500)
    }
    return ((data ?? []) as RoomRow[]).sort((left, right) => {
      const statusDelta = ROOM_STATUS_ORDER[left.status] - ROOM_STATUS_ORDER[right.status]
      if (statusDelta !== 0) return statusDelta
      return Date.parse(right.created_at) - Date.parse(left.created_at)
    })
  }

  async function getRoomRow(roomRef: string) {
    const column = UUID_PATTERN.test(roomRef) ? 'id' : 'slug'
    const { data, error } = await supabase
      .from('rooms')
      .select('id, slug, title, home_name, home_code, home_iso2, home_flag, away_name, away_code, away_iso2, away_flag, status, event_date, created_at')
      .eq(column, roomRef)
      .maybeSingle()

    if (error) {
      logSupabaseError('getRoomRow', error)
      throw new ApiError('INTERNAL_ERROR', 'Unable to load room.', 500)
    }
    return data as RoomRow | null
  }

  async function getPredictions(roomIds: string[]) {
    if (roomIds.length === 0) return []
    const { data, error } = await supabase
      .from('predictions')
      .select('id, room_id, author_id, author_name, home_score, away_score, take, created_at')
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
    const { data, error } = await supabase
      .from('prediction_likes')
      .select('prediction_id, user_id')
      .in('prediction_id', predictionIds)

    if (error) {
      logSupabaseError('getLikes', error)
      throw new ApiError('INTERNAL_ERROR', 'Unable to load likes.', 500)
    }
    return (data ?? []) as LikeRow[]
  }

  async function getComments(predictionIds: string[]) {
    if (predictionIds.length === 0) return []
    const { data, error } = await supabase
      .from('comments')
      .select('id, prediction_id, author_id, author_name, text, created_at')
      .in('prediction_id', predictionIds)
      .eq('hidden', false)
      .order('created_at', { ascending: true })

    if (error) {
      logSupabaseError('getComments', error)
      throw new ApiError('INTERNAL_ERROR', 'Unable to load comments.', 500)
    }
    return (data ?? []) as CommentRow[]
  }

  async function getReplies(commentIds: string[]) {
    if (commentIds.length === 0) return []
    const { data, error } = await supabase
      .from('comment_replies')
      .select('id, comment_id, author_id, author_name, text, created_at')
      .in('comment_id', commentIds)
      .eq('hidden', false)
      .order('created_at', { ascending: true })

    if (error) {
      logSupabaseError('getReplies', error)
      throw new ApiError('INTERNAL_ERROR', 'Unable to load replies.', 500)
    }
    return (data ?? []) as ReplyRow[]
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

  async function getPredictionOwner(predictionId: string) {
    const { data, error } = await supabase
      .from('predictions')
      .select('id, room_id, author_id')
      .eq('id', predictionId)
      .maybeSingle()

    if (error) throw new ApiError('INTERNAL_ERROR', 'Unable to load prediction.', 500)
    return data as { id: string; room_id: string; author_id: string } | null
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
      if (!ROOM_WRITE_STATUSES.has(room.status)) {
        throw new ApiError('FORBIDDEN', 'This room is closed for new predictions.', 403)
      }

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
  }
}
