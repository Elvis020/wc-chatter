import { type SupabaseClient } from '@supabase/supabase-js'
import {
  currentOrNextCycleMatches,
  loadFixtures,
  matchKickoffUtc,
  matchCycleWindowForKickoff,
  matchStatusAt,
  type FixtureMatch,
  type MatchStatus,
  type RoomInteractionStatus,
} from '@turntabl-score-room/shared'
import { ApiError } from './errors.js'

type DbRoomStatus = 'draft' | 'live' | 'closed' | 'archived'

type ExistingRoom = {
  slug: string
  status: DbRoomStatus
  match_status?: MatchStatus | null
  room_status?: RoomInteractionStatus | null
  is_featured?: boolean | null
}

type RoomUpsert = {
  slug: string
  title: string
  home_name: string
  home_code: string
  home_iso2: string
  home_flag: string
  away_name: string
  away_code: string
  away_iso2: string
  away_flag: string
  event_date: string
  kickoff_at: string
  round: string
  group_name: string
  venue: string
  status: DbRoomStatus
  match_status: MatchStatus
  room_status: RoomInteractionStatus
  is_featured: boolean
  source: 'fixture'
  source_match_id: string
}

type BaseRoomUpsert = Omit<RoomUpsert, 'kickoff_at' | 'round' | 'group_name' | 'venue' | 'match_status' | 'room_status' | 'is_featured' | 'source' | 'source_match_id'>

export type SyncedRoom = {
  id: string
  slug: string
  title: string
  status: DbRoomStatus
}

export type RoomSyncResult = {
  matched: number
  upserted: number
  dryRun: boolean
  rooms: Array<SyncedRoom | RoomUpsert>
}

const LOCKED_ROOM_STATUSES = new Set<RoomInteractionStatus>(['closed', 'hidden'])

const KNOCKOUT_ROUNDS = [
  'Round of 32',
  'Round of 16',
  'Quarter-final',
  'Semi-final',
  'Match for third place',
  'Final',
]
const MATCH_CYCLE_MS = 24 * 60 * 60 * 1000

function isMissingColumnError(error?: { code?: string } | null) {
  return error?.code === 'PGRST204' || error?.code === '42703'
}

function matchStatusForMatch(match: FixtureMatch, now: Date): MatchStatus {
  return matchStatusAt(match, now)
}

function legacyStatusFor(matchStatus: MatchStatus, roomStatus: RoomInteractionStatus): DbRoomStatus {
  if (roomStatus !== 'open') return roomStatus === 'hidden' ? 'archived' : 'closed'
  if (matchStatus === 'live') return 'live'
  if (matchStatus === 'finished') return 'archived'
  return 'draft'
}

function legacyRoomStatus(status: DbRoomStatus): RoomInteractionStatus {
  if (status === 'closed' || status === 'archived') return 'closed'
  return 'open'
}

function roomFromMatch(match: FixtureMatch, now: Date, isFeatured: boolean, existing?: ExistingRoom): RoomUpsert {
  const matchStatus = matchStatusForMatch(match, now)
  const existingRoomStatus = existing?.room_status ?? (existing ? legacyRoomStatus(existing.status) : undefined)
  const roomStatus = existingRoomStatus && LOCKED_ROOM_STATUSES.has(existingRoomStatus) ? existingRoomStatus : 'open'
  const status = legacyStatusFor(matchStatus, roomStatus)

  return {
    slug: match.id,
    title: `${match.home.name} vs ${match.away.name}`,
    home_name: match.home.name,
    home_code: match.home.code,
    home_iso2: match.home.iso2,
    home_flag: match.home.flag,
    away_name: match.away.name,
    away_code: match.away.code,
    away_iso2: match.away.iso2,
    away_flag: match.away.flag,
    event_date: match.date,
    kickoff_at: matchKickoffUtc(match),
    round: match.round,
    group_name: match.group,
    venue: match.venue,
    status,
    match_status: matchStatus,
    room_status: roomStatus,
    is_featured: isFeatured,
    source: 'fixture',
    source_match_id: match.id,
  }
}

function baseRoom(row: RoomUpsert): BaseRoomUpsert {
  return {
    slug: row.slug,
    title: row.title,
    home_name: row.home_name,
    home_code: row.home_code,
    home_iso2: row.home_iso2,
    home_flag: row.home_flag,
    away_name: row.away_name,
    away_code: row.away_code,
    away_iso2: row.away_iso2,
    away_flag: row.away_flag,
    event_date: row.event_date,
    status: row.status,
  }
}

async function getExistingRooms(supabase: SupabaseClient, slugs: string[]) {
  if (slugs.length === 0) return new Map<string, ExistingRoom>()

  let response: any = await supabase
    .from('rooms')
    .select('slug, status, match_status, room_status, is_featured')
    .in('slug', slugs)

  if (isMissingColumnError(response.error)) {
    response = await supabase
      .from('rooms')
      .select('slug, status')
      .in('slug', slugs)
  }

  if (response.error) {
    throw new ApiError('INTERNAL_ERROR', 'Unable to read existing rooms before sync.', 500)
  }

  return new Map(((response.data ?? []) as ExistingRoom[]).map((room) => [room.slug, room]))
}

function activeKnockoutRound(matches: FixtureMatch[], now: Date) {
  const startedRounds = KNOCKOUT_ROUNDS.filter((round) =>
    matches.some((match) => match.round === round && Date.parse(matchKickoffUtc(match)) <= now.getTime()),
  )
  return startedRounds.at(-1)
}

export function selectSyncMatches(matches: FixtureMatch[], now: Date) {
  const knockoutRound = activeKnockoutRound(matches, now)
  if (!knockoutRound) return currentOrNextCycleMatches(matches, now, undefined, 2)

  const tomorrowCycleEndMs = Date.parse(matchCycleWindowForKickoff(new Date(now.getTime() + MATCH_CYCLE_MS)).endUtc)
  return matches
    .filter((match) => match.round === knockoutRound && Date.parse(matchKickoffUtc(match)) <= tomorrowCycleEndMs)
    .sort((left, right) => Date.parse(matchKickoffUtc(left)) - Date.parse(matchKickoffUtc(right)))
}

export async function syncCurrentCycleRooms(
  supabase: SupabaseClient,
  options: { now?: Date; dryRun?: boolean } = {},
): Promise<RoomSyncResult> {
  const now = options.now ?? new Date()
  const matches = selectSyncMatches(loadFixtures(), now)
  const existingRooms = await getExistingRooms(supabase, matches.map((match) => match.id))
  const featuredMatchId = matches.find((match) => matchStatusForMatch(match, now) === 'live')?.id ?? matches[0]?.id
  const rows = matches.map((match) => roomFromMatch(match, now, match.id === featuredMatchId, existingRooms.get(match.id)))

  if (options.dryRun) {
    return {
      matched: matches.length,
      upserted: 0,
      dryRun: true,
      rooms: rows,
    }
  }

  await supabase.from('rooms').update({ is_featured: false }).eq('is_featured', true)

  let response = await supabase
    .from('rooms')
    .upsert(rows, { onConflict: 'slug' })
    .select('id, slug, title, status')

  if (isMissingColumnError(response.error)) {
    console.warn('Room sync is using legacy room columns. Reload Supabase/PostgREST schema after applying the room visibility migration.')
    response = await supabase
      .from('rooms')
      .upsert(rows.map(baseRoom), { onConflict: 'slug' })
      .select('id, slug, title, status')
  }

  if (response.error) {
    console.error('Supabase error', {
      operation: 'syncCurrentCycleRooms',
      code: response.error.code,
      message: response.error.message,
      details: response.error.details,
      hint: response.error.hint,
    })
    throw new ApiError('INTERNAL_ERROR', 'Unable to sync rooms.', 500)
  }

  return {
    matched: matches.length,
    upserted: response.data?.length ?? 0,
    dryRun: false,
    rooms: (response.data ?? []) as SyncedRoom[],
  }
}
