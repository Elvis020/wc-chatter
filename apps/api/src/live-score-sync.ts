import { type SupabaseClient } from '@supabase/supabase-js'
import {
  loadFixtures,
  matchKickoffUtcMs,
  matchStatusAt,
  type FixtureMatch,
  type MatchStatus,
  type RoomInteractionStatus,
} from '@turntabl-score-room/shared'
import {
  EspnWorldCupApiProvider,
  MergedLiveScorelineProvider,
  scorelineKeyForNames,
  WorldCup26ApiProvider,
  type LiveScoreline,
  type LiveScorelineProvider,
} from './live-score-providers.js'
import { ApiError } from './errors.js'

type DbRoomStatus = 'draft' | 'live' | 'closed' | 'archived'

type ScoreRoomRow = {
  slug: string
  status: DbRoomStatus
  room_status?: RoomInteractionStatus | null
}

type ScoreRoomUpdate = {
  slug: string
  status: DbRoomStatus
  match_status: MatchStatus
  room_status?: RoomInteractionStatus
  is_featured: boolean
  current_home_score: number | null
  current_away_score: number | null
  score_status: LiveScoreline['status']
  score_clock: string | null
  score_provider: string | null
  score_updated_at: string
}

export type LiveScoreSyncResult = {
  checked: boolean
  candidateRooms: number
  scorelines: number
  updated: number
  dryRun?: boolean
  reason?: string
}

const LIVE_WINDOW_BEFORE_MS = 15 * 60 * 1000
const LIVE_WINDOW_AFTER_MS = 140 * 60 * 1000
const LOCKED_ROOM_STATUSES = new Set<RoomInteractionStatus>(['closed', 'hidden'])

function isMissingColumnError(error?: { code?: string } | null) {
  return error?.code === 'PGRST204' || error?.code === '42703'
}

function legacyRoomStatus(status: DbRoomStatus): RoomInteractionStatus {
  if (status === 'closed' || status === 'archived') return 'closed'
  return 'open'
}

function legacyStatusFor(matchStatus: MatchStatus, roomStatus: RoomInteractionStatus): DbRoomStatus {
  if (roomStatus !== 'open') return roomStatus === 'hidden' ? 'archived' : 'closed'
  if (matchStatus === 'live') return 'live'
  if (matchStatus === 'finished') return 'archived'
  return 'draft'
}

function isInLiveScoreWindow(match: FixtureMatch, now: Date) {
  const kickoffMs = matchKickoffUtcMs(match)
  const nowMs = now.getTime()
  return nowMs >= kickoffMs - LIVE_WINDOW_BEFORE_MS && nowMs <= kickoffMs + LIVE_WINDOW_AFTER_MS
}

function scorelineMatch(scoreline: LiveScoreline, match: FixtureMatch) {
  const datedKey = `${scoreline.date}:${scorelineKeyForNames(scoreline.homeName, scoreline.awayName)}`
  const matchDatedKey = `${match.date}:${scorelineKeyForNames(match.homeName, match.awayName)}`
  const looseKey = scorelineKeyForNames(scoreline.homeName, scoreline.awayName)
  const matchLooseKey = scorelineKeyForNames(match.homeName, match.awayName)
  return datedKey === matchDatedKey || looseKey === matchLooseKey
}

function matchStatusFromScoreline(scoreline: LiveScoreline | undefined, match: FixtureMatch, now: Date): MatchStatus {
  if (scoreline?.status === 'live') return 'live'
  if (scoreline?.status === 'finished') return 'finished'
  return matchStatusAt(match, now)
}

async function getExistingRooms(supabase: SupabaseClient, slugs: string[]) {
  if (slugs.length === 0) return new Map<string, ScoreRoomRow>()

  let response: any = await supabase
    .from('rooms')
    .select('slug, status, room_status')
    .in('slug', slugs)

  if (isMissingColumnError(response.error)) {
    response = await supabase
      .from('rooms')
      .select('slug, status')
      .in('slug', slugs)
  }

  if (response.error) {
    throw new ApiError('INTERNAL_ERROR', 'Unable to read rooms before live score sync.', 500)
  }

  return new Map(((response.data ?? []) as ScoreRoomRow[]).map((room) => [room.slug, room]))
}

async function updateExistingRooms(
  supabase: SupabaseClient,
  rows: Array<{ slug: string } & Record<string, unknown>>,
) {
  const updated: Array<{ slug: string }> = []

  for (const row of rows) {
    const { slug, ...values } = row
    const { data, error } = await supabase
      .from('rooms')
      .update(values)
      .eq('slug', slug)
      .select('slug')

    if (error) {
      return { data: updated, error }
    }

    updated.push(...((data ?? []) as Array<{ slug: string }>))
  }

  return { data: updated, error: null }
}

export async function syncLiveRoomScores(
  supabase: SupabaseClient,
  options: { now?: Date; provider?: LiveScorelineProvider; dryRun?: boolean } = {},
): Promise<LiveScoreSyncResult> {
  const now = options.now ?? new Date()
  const candidates = loadFixtures().filter((match) => isInLiveScoreWindow(match, now))

  if (candidates.length === 0) {
    return {
      checked: false,
      candidateRooms: 0,
      scorelines: 0,
      updated: 0,
      reason: 'No fixtures are inside the live score window.',
    }
  }

  const provider =
    options.provider ??
    new MergedLiveScorelineProvider([
      new EspnWorldCupApiProvider(),
      new WorldCup26ApiProvider(),
    ])
  const scorelines = await provider.fetchScorelines()
  const existingRooms = await getExistingRooms(supabase, candidates.map((match) => match.id))

  const rows = candidates.map<ScoreRoomUpdate | null>((match) => {
    const room = existingRooms.get(match.id)
    if (!room) return null

    const scoreline = scorelines.find((item) => scorelineMatch(item, match))
    const roomStatus = room.room_status ?? legacyRoomStatus(room.status)
    const keptRoomStatus = LOCKED_ROOM_STATUSES.has(roomStatus) ? roomStatus : 'open'
    const matchStatus = matchStatusFromScoreline(scoreline, match, now)

    return {
      slug: match.id,
      status: legacyStatusFor(matchStatus, keptRoomStatus),
      match_status: matchStatus,
      room_status: keptRoomStatus,
      is_featured: false,
      current_home_score: scoreline ? scoreline.homeGoals : null,
      current_away_score: scoreline ? scoreline.awayGoals : null,
      score_status: scoreline?.status ?? (matchStatus === 'live' ? 'live' : matchStatus === 'finished' ? 'finished' : 'scheduled'),
      score_clock: scoreline?.clock ?? null,
      score_provider: scoreline?.provider ?? null,
      score_updated_at: scoreline?.updatedAt ?? now.toISOString(),
    }
  }).filter((row): row is ScoreRoomUpdate => Boolean(row))

  const featuredSlug = rows.find((row) => row.match_status === 'live')?.slug
  const upserts = rows.map((row) => ({
    ...row,
    is_featured: row.slug === featuredSlug,
  }))

  if (upserts.length === 0) {
    return {
      checked: true,
      candidateRooms: candidates.length,
      scorelines: scorelines.length,
      updated: 0,
      dryRun: options.dryRun,
      reason: 'No synced rooms matched the live score window fixtures.',
    }
  }

  if (options.dryRun) {
    return {
      checked: true,
      candidateRooms: candidates.length,
      scorelines: scorelines.length,
      updated: 0,
      dryRun: true,
    }
  }

  await supabase.from('rooms').update({ is_featured: false }).eq('is_featured', true)

  let response: any = await supabase
    .from('rooms')
    .upsert(upserts, { onConflict: 'slug' })
    .select('slug')

  if (isMissingColumnError(response.error)) {
    console.warn('Live score sync is using room-state columns without score columns. Apply the scoreline migration and reload Supabase/PostgREST schema.')
    response = await updateExistingRooms(
      supabase,
      upserts.map(({ slug, status, match_status, room_status, is_featured }) => ({
        slug,
        status,
        match_status,
        room_status,
        is_featured,
      })),
    )
  }

  if (isMissingColumnError(response.error)) {
    console.warn('Live score sync is using legacy room status only. Apply room visibility migrations and reload Supabase/PostgREST schema.')
    response = await updateExistingRooms(
      supabase,
      upserts.map(({ slug, status }) => ({ slug, status })),
    )
  }

  if (response.error) {
    console.error('Supabase error', {
      operation: 'syncLiveRoomScores',
      code: response.error.code,
      message: response.error.message,
      details: response.error.details,
      hint: response.error.hint,
    })
    throw new ApiError('INTERNAL_ERROR', 'Unable to sync live room scores.', 500)
  }

  return {
    checked: true,
    candidateRooms: candidates.length,
    scorelines: scorelines.length,
    updated: response.data?.length ?? 0,
  }
}

export const liveScoreSyncWindow = {
  beforeMs: LIVE_WINDOW_BEFORE_MS,
  afterMs: LIVE_WINDOW_AFTER_MS,
}
