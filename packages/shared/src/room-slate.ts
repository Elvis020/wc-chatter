import {
  DEFAULT_MATCH_CYCLE_START_HOUR_UTC,
  currentOrNextCycleMatches,
  matchCycleDateForKickoff,
  matchKickoffUtc,
  matchKickoffUtcMs,
  type FixtureMatch,
} from './fixtures.js'
import type { Room } from './index.js'

export const DEFAULT_ROOM_SLATE_CYCLE_COUNT = 1

export type RoomDayBucket = {
  key: string
  label: string
  startMs: number
  rooms: Room[]
}

export function selectRoomSlateMatches(
  matches: FixtureMatch[],
  options: {
    now?: Date
    startHourUtc?: number
    cycleCount?: number
  } = {},
) {
  return currentOrNextCycleMatches(
    matches,
    options.now ?? new Date(),
    options.startHourUtc ?? DEFAULT_MATCH_CYCLE_START_HOUR_UTC,
    options.cycleCount ?? DEFAULT_ROOM_SLATE_CYCLE_COUNT,
  )
}

export function roomCycleDateKey(
  kickoff: Date | string | number,
  startHourUtc = DEFAULT_MATCH_CYCLE_START_HOUR_UTC,
) {
  return matchCycleDateForKickoff(kickoff, startHourUtc)
}

export function roomCycleStartMs(
  cycleKey: string,
  startHourUtc = DEFAULT_MATCH_CYCLE_START_HOUR_UTC,
) {
  const [year, month, day] = cycleKey.split('-').map(Number)
  if (!year || !month || !day) return 0
  return Date.UTC(year, month - 1, day, startHourUtc, 0, 0)
}

export function roomBucketLabel(cycleKey: string, currentCycleKey: string) {
  const dayDelta = Math.round((roomCycleStartMs(cycleKey) - roomCycleStartMs(currentCycleKey)) / (24 * 60 * 60 * 1000))
  if (dayDelta === 1) return 'Tomorrow'
  if (dayDelta === 0) return 'Today'
  if (dayDelta === -1) return 'Yesterday'

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
  }).format(new Date(`${cycleKey}T12:00:00.000Z`))
}

export function groupRoomsByCycle(
  rooms: Room[],
  options: {
    now?: Date
    startHourUtc?: number
    kickoffMsForRoom?: (room: Room) => number
  } = {},
): RoomDayBucket[] {
  const startHourUtc = options.startHourUtc ?? DEFAULT_MATCH_CYCLE_START_HOUR_UTC
  const kickoffMsForRoom = options.kickoffMsForRoom ?? ((room: Room) => room.kickoffAt ? Date.parse(room.kickoffAt) : 0)
  const currentCycleKey = roomCycleDateKey(options.now ?? Date.now(), startHourUtc)
  const buckets = new Map<string, Room[]>()

  for (const room of rooms) {
    const key = roomCycleDateKey(kickoffMsForRoom(room), startHourUtc)
    buckets.set(key, [...(buckets.get(key) ?? []), room])
  }

  return [...buckets.entries()]
    .map(([key, bucketRooms]) => ({
      key,
      label: roomBucketLabel(key, currentCycleKey),
      startMs: roomCycleStartMs(key, startHourUtc),
      rooms: bucketRooms,
    }))
    .sort((left, right) => right.startMs - left.startMs)
}

export function fallbackLatestMatches(matches: FixtureMatch[], count = 4) {
  return [...matches]
    .sort((left, right) => matchKickoffUtcMs(right) - matchKickoffUtcMs(left))
    .slice(0, count)
    .reverse()
}

export function fixtureCycleKey(match: FixtureMatch, startHourUtc = DEFAULT_MATCH_CYCLE_START_HOUR_UTC) {
  return roomCycleDateKey(matchKickoffUtc(match), startHourUtc)
}
