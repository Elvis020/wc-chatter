import { describe, expect, test } from 'bun:test'
import {
  compareRoomsForSwitcher,
  effectiveRoomMatchStatus,
  isRoomLocked,
  matchStatusFromKickoff,
  roomKickoffTime,
  type Room,
} from '../src/index'

const baseRoom: Room = {
  id: 'base',
  status: 'upcoming',
  matchStatus: 'upcoming',
  roomStatus: 'open',
  kickoffAt: '2026-06-19T16:00:00.000Z',
  isFeatured: false,
  home: { name: 'Ghana', code: 'GHA', iso2: 'GH', flag: '🇬🇭' },
  away: { name: 'England', code: 'ENG', iso2: 'GB', flag: '🏴' },
  mostBacked: { home: 0, away: 0, margin: 'No picks yet' },
  predictions: [],
}

function room(overrides: Partial<Room>): Room {
  return {
    ...baseRoom,
    ...overrides,
    home: { ...baseRoom.home, ...overrides.home },
    away: { ...baseRoom.away, ...overrides.away },
  }
}

describe('room state', () => {
  test('derives match status from kickoff window', () => {
    const kickoff = '2026-06-19T16:00:00.000Z'

    expect(matchStatusFromKickoff(kickoff, new Date('2026-06-19T15:59:59.000Z'))).toBe('upcoming')
    expect(matchStatusFromKickoff(kickoff, new Date('2026-06-19T16:30:00.000Z'))).toBe('live')
    expect(matchStatusFromKickoff(kickoff, new Date('2026-06-19T18:01:00.000Z'))).toBe('finished')
  })

  test('current score wins over stale room status', () => {
    const liveRoom = room({
      matchStatus: 'upcoming',
      currentScore: {
        home: 1,
        away: 0,
        status: 'live',
        clock: '22',
        provider: 'test',
        updatedAt: '2026-06-19T16:22:00.000Z',
      },
    })

    expect(effectiveRoomMatchStatus(liveRoom, { now: new Date('2026-06-19T15:00:00.000Z') })).toBe('live')
  })

  test('sorts live and upcoming rooms before locked rooms', () => {
    const rooms = [
      room({ id: 'finished', kickoffAt: '2026-06-18T16:00:00.000Z', matchStatus: 'finished' }),
      room({ id: 'later', kickoffAt: '2026-06-19T20:00:00.000Z' }),
      room({ id: 'live', kickoffAt: '2026-06-19T16:00:00.000Z' }),
      room({ id: 'earlier', kickoffAt: '2026-06-19T18:00:00.000Z' }),
    ].sort((left, right) => compareRoomsForSwitcher(left, right, { now: new Date('2026-06-19T16:30:00.000Z') }))

    expect(rooms.map((item) => item.id)).toEqual(['live', 'earlier', 'later', 'finished'])
    expect(isRoomLocked(rooms.at(-1)!, { now: new Date('2026-06-19T16:30:00.000Z') })).toBe(true)
  })

  test('formats kickoff time consistently', () => {
    expect(roomKickoffTime(baseRoom)).toBe('16:00')
  })
})
