import { type SupabaseClient } from '@supabase/supabase-js'
import {
  currentOrNextCycleMatches,
  loadFixtures,
  matchKickoffUtc,
  matchKickoffUtcMs,
  type FixtureMatch,
} from '@wc-chatter/shared'
import { ApiError } from './errors.js'

type DbRoomStatus = 'draft' | 'live' | 'closed' | 'archived'

type ExistingRoom = {
  slug: string
  status: DbRoomStatus
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
  source: 'fixture'
  source_match_id: string
}

type BaseRoomUpsert = Omit<RoomUpsert, 'kickoff_at' | 'round' | 'group_name' | 'venue' | 'source' | 'source_match_id'>

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

const LOCKED_STATUSES = new Set<DbRoomStatus>(['closed', 'archived'])

function roomStatusForMatch(match: FixtureMatch, now: Date): DbRoomStatus {
  if (match.result?.status === 'FT') return 'archived'
  return matchKickoffUtcMs(match) <= now.getTime() ? 'live' : 'draft'
}

function roomFromMatch(match: FixtureMatch, now: Date, existing?: ExistingRoom): RoomUpsert {
  const computedStatus = roomStatusForMatch(match, now)
  const status = existing && LOCKED_STATUSES.has(existing.status) ? existing.status : computedStatus

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

  const { data, error } = await supabase
    .from('rooms')
    .select('slug, status')
    .in('slug', slugs)

  if (error) {
    throw new ApiError('INTERNAL_ERROR', 'Unable to read existing rooms before sync.', 500)
  }

  return new Map(((data ?? []) as ExistingRoom[]).map((room) => [room.slug, room]))
}

export async function syncCurrentCycleRooms(
  supabase: SupabaseClient,
  options: { now?: Date; dryRun?: boolean } = {},
): Promise<RoomSyncResult> {
  const now = options.now ?? new Date()
  const matches = currentOrNextCycleMatches(loadFixtures(), now)
  const existingRooms = await getExistingRooms(supabase, matches.map((match) => match.id))
  const rows = matches.map((match) => roomFromMatch(match, now, existingRooms.get(match.id)))

  if (options.dryRun) {
    return {
      matched: matches.length,
      upserted: 0,
      dryRun: true,
      rooms: rows,
    }
  }

  let response = await supabase
    .from('rooms')
    .upsert(rows, { onConflict: 'slug' })
    .select('id, slug, title, status')

  if (response.error?.code === 'PGRST204') {
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
