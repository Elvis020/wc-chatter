import {
  MATCH_LIVE_DURATION_MS,
  matchKickoffUtcMs,
  matchStatusAt,
  type FixtureMatch,
  type MatchStatus,
  type RoomInteractionStatus,
} from '@turntabl-score-room/shared'
import { scorelineKeyForNames, type LiveScoreline } from './live-score-providers.js'

export type DbRoomStatus = 'draft' | 'live' | 'closed' | 'archived'

export type ScoreRoomRow = {
  slug: string
  status: DbRoomStatus
  room_status?: RoomInteractionStatus | null
  current_home_score?: number | null
  current_away_score?: number | null
  score_status?: LiveScoreline['status'] | null
}

export type ScoreRoomUpdate = {
  slug: string
  status: DbRoomStatus
  match_status: MatchStatus
  room_status: RoomInteractionStatus
  is_featured: boolean
  current_home_score: number | null
  current_away_score: number | null
  score_status: LiveScoreline['status']
  score_clock: string | null
  score_provider: string | null
  score_updated_at: string
}

export const LIVE_WINDOW_BEFORE_MS = 15 * 60 * 1000
export const LIVE_WINDOW_AFTER_MS = 140 * 60 * 1000
const FINISHED_SCORE_BACKFILL_AFTER_MS = 48 * 60 * 60 * 1000
const LOCKED_ROOM_STATUSES = new Set<RoomInteractionStatus>(['closed', 'hidden'])

export function legacyRoomStatus(status: DbRoomStatus): RoomInteractionStatus {
  if (status === 'closed' || status === 'archived') return 'closed'
  return 'open'
}

export function legacyStatusFor(matchStatus: MatchStatus, roomStatus: RoomInteractionStatus): DbRoomStatus {
  if (roomStatus !== 'open') return roomStatus === 'hidden' ? 'archived' : 'closed'
  if (matchStatus === 'live') return 'live'
  if (matchStatus === 'finished') return 'archived'
  return 'draft'
}

export function isInLiveScoreWindow(match: FixtureMatch, now: Date) {
  const kickoffMs = matchKickoffUtcMs(match)
  const nowMs = now.getTime()
  return nowMs >= kickoffMs - LIVE_WINDOW_BEFORE_MS && nowMs <= kickoffMs + LIVE_WINDOW_AFTER_MS
}

export function isInFinishedScoreBackfillWindow(match: FixtureMatch, now: Date) {
  const kickoffMs = matchKickoffUtcMs(match)
  const nowMs = now.getTime()
  return nowMs > kickoffMs + MATCH_LIVE_DURATION_MS && nowMs <= kickoffMs + FINISHED_SCORE_BACKFILL_AFTER_MS
}

export function selectLiveScoreCandidates(matches: FixtureMatch[], now: Date) {
  const liveWindowMatches = matches.filter((match) => isInLiveScoreWindow(match, now))
  const backfillMatches = matches.filter((match) => isInFinishedScoreBackfillWindow(match, now))
  const candidates = [...new Map([...liveWindowMatches, ...backfillMatches].map((match) => [match.id, match])).values()]
  const liveWindowSlugs = new Set(liveWindowMatches.map((match) => match.id))
  return { candidates, liveWindowSlugs }
}

export function hasFinishedScore(room: ScoreRoomRow) {
  return (
    room.current_home_score !== undefined &&
    room.current_home_score !== null &&
    room.current_away_score !== undefined &&
    room.current_away_score !== null &&
    room.score_status === 'finished'
  )
}

export function scorelineMatch(scoreline: LiveScoreline, match: FixtureMatch) {
  const datedKey = `${scoreline.date}:${scorelineKeyForNames(scoreline.homeName, scoreline.awayName)}`
  const matchDatedKey = `${match.date}:${scorelineKeyForNames(match.homeName, match.awayName)}`
  const looseKey = scorelineKeyForNames(scoreline.homeName, scoreline.awayName)
  const matchLooseKey = scorelineKeyForNames(match.homeName, match.awayName)
  return datedKey === matchDatedKey || looseKey === matchLooseKey
}

export function matchStatusFromScoreline(scoreline: LiveScoreline | undefined, match: FixtureMatch, now: Date): MatchStatus {
  if (scoreline?.status === 'live') return 'live'
  if (scoreline?.status === 'finished') return 'finished'
  return matchStatusAt(match, now)
}

export function buildScoreRoomUpdate(
  match: FixtureMatch,
  room: ScoreRoomRow | undefined,
  scorelines: LiveScoreline[],
  options: { now: Date; isBackfillOnly: boolean },
): ScoreRoomUpdate | null {
  if (!room) return null

  const scoreline = scorelines.find((item) => scorelineMatch(item, match))
  if (options.isBackfillOnly && (hasFinishedScore(room) || scoreline?.status !== 'finished')) return null

  const roomStatus = room.room_status ?? legacyRoomStatus(room.status)
  const keptRoomStatus = LOCKED_ROOM_STATUSES.has(roomStatus) ? roomStatus : 'open'
  const matchStatus = matchStatusFromScoreline(scoreline, match, options.now)

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
    score_updated_at: scoreline?.updatedAt ?? options.now.toISOString(),
  } satisfies ScoreRoomUpdate
}
