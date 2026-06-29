import type { MatchStatus, Room } from './index.js'
import { MATCH_LIVE_DURATION_MS } from './fixtures.js'

export type FixtureKickoffLookup = Map<string, string>

export function matchStatusFromKickoff(kickoffAt?: string | null, now = new Date()): MatchStatus | null {
  if (!kickoffAt) return null

  const kickoffMs = Date.parse(kickoffAt)
  if (!Number.isFinite(kickoffMs)) return null

  const nowMs = now.getTime()
  if (nowMs < kickoffMs) return 'upcoming'
  if (nowMs <= kickoffMs + MATCH_LIVE_DURATION_MS) return 'live'
  return 'finished'
}

export function roomKickoffIso(room: Room, fixtureKickoffs?: FixtureKickoffLookup) {
  return room.kickoffAt ?? fixtureKickoffs?.get(room.id) ?? fixtureKickoffs?.get(`${room.home.code}-${room.away.code}`) ?? ''
}

export function roomKickoffMs(room: Room, fixtureKickoffs?: FixtureKickoffLookup) {
  const kickoffIso = roomKickoffIso(room, fixtureKickoffs)
  if (!kickoffIso) return Number.POSITIVE_INFINITY

  const kickoffMs = Date.parse(kickoffIso)
  return Number.isFinite(kickoffMs) ? kickoffMs : Number.POSITIVE_INFINITY
}

export function effectiveRoomMatchStatus(room: Room, options: { now?: Date; fixtureKickoffs?: FixtureKickoffLookup } = {}): MatchStatus {
  const kickoffStatus = matchStatusFromKickoff(roomKickoffIso(room, options.fixtureKickoffs), options.now)
  if (room.currentScore?.status === 'finished') return 'finished'
  if (room.currentScore?.status === 'live' && kickoffStatus !== 'finished') return 'live'

  return kickoffStatus ?? room.matchStatus
}

export function isRoomLocked(room: Room, options: { now?: Date; fixtureKickoffs?: FixtureKickoffLookup } = {}) {
  return effectiveRoomMatchStatus(room, options) === 'finished' || room.roomStatus === 'closed'
}

export function roomLockedAtMs(room: Room, fixtureKickoffs?: FixtureKickoffLookup) {
  const scoreUpdatedAt = room.currentScore?.status === 'finished' ? Date.parse(room.currentScore.updatedAt) : NaN
  if (Number.isFinite(scoreUpdatedAt)) return scoreUpdatedAt

  const kickoffMs = roomKickoffMs(room, fixtureKickoffs)
  if (Number.isFinite(kickoffMs)) return kickoffMs + MATCH_LIVE_DURATION_MS

  return Number.NEGATIVE_INFINITY
}

export function compareRoomsForSwitcher(left: Room, right: Room, options: { now?: Date; fixtureKickoffs?: FixtureKickoffLookup } = {}) {
  const leftLocked = isRoomLocked(left, options)
  const rightLocked = isRoomLocked(right, options)
  if (leftLocked !== rightLocked) return leftLocked ? 1 : -1

  if (leftLocked && rightLocked) {
    return roomLockedAtMs(right, options.fixtureKickoffs) - roomLockedAtMs(left, options.fixtureKickoffs)
  }

  const leftLive = effectiveRoomMatchStatus(left, options) === 'live'
  const rightLive = effectiveRoomMatchStatus(right, options) === 'live'
  if (leftLive !== rightLive) return leftLive ? -1 : 1

  return roomKickoffMs(left, options.fixtureKickoffs) - roomKickoffMs(right, options.fixtureKickoffs)
}

export function roomKickoffTime(room: Room, fixtureKickoffs?: FixtureKickoffLookup) {
  const kickoffIso = roomKickoffIso(room, fixtureKickoffs)
  if (!kickoffIso) return ''

  const kickoff = new Date(kickoffIso)
  if (Number.isNaN(kickoff.getTime())) return ''

  return `${String(kickoff.getHours()).padStart(2, '0')}:${String(kickoff.getMinutes()).padStart(2, '0')}`
}
