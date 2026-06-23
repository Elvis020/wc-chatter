import { describe, expect, test } from 'bun:test'
import {
  groupRoomsByCycle,
  selectRoomSlateMatches,
  type FixtureMatch,
  type Room,
} from '../src/index'

function fixture(id: string, date: string, time = '19:00 UTC+0'): FixtureMatch {
  return {
    id,
    date,
    time,
    round: 'Group stage',
    group: 'A',
    venue: 'Test Stadium',
    home: { name: `Home ${id}`, code: `H${id}`, iso2: 'US', flag: '🇺🇸' },
    away: { name: `Away ${id}`, code: `A${id}`, iso2: 'AU', flag: '🇦🇺' },
  }
}

function room(id: string, kickoffAt: string): Room {
  return {
    id,
    status: 'upcoming',
    matchStatus: 'upcoming',
    roomStatus: 'open',
    kickoffAt,
    isFeatured: false,
    home: { name: 'USA', code: 'USA', iso2: 'US', flag: '🇺🇸' },
    away: { name: 'Australia', code: 'AUS', iso2: 'AU', flag: '🇦🇺' },
    mostBacked: { home: 0, away: 0, margin: 'No picks yet' },
    predictions: [],
  }
}

describe('room slate', () => {
  test('selects only the active match cycle by default', () => {
    const matches = [
      fixture('1', '2026-06-22'),
      fixture('2', '2026-06-22', '22:00 UTC+0'),
      fixture('3', '2026-06-23'),
      fixture('4', '2026-06-23', '22:00 UTC+0'),
    ]

    expect(selectRoomSlateMatches(matches, { now: new Date('2026-06-22T12:00:00.000Z') }).map((match) => match.id)).toEqual([
      '1',
      '2',
    ])
  })

  test('can opt into multiple cycles when a caller explicitly needs them', () => {
    const matches = [
      fixture('1', '2026-06-22'),
      fixture('2', '2026-06-23'),
    ]

    expect(
      selectRoomSlateMatches(matches, {
        now: new Date('2026-06-22T12:00:00.000Z'),
        cycleCount: 2,
      }).map((match) => match.id),
    ).toEqual(['1', '2'])
  })

  test('groups rooms into labeled cycle buckets', () => {
    const buckets = groupRoomsByCycle(
      [
        room('today', '2026-06-22T19:00:00.000Z'),
        room('tomorrow', '2026-06-23T19:00:00.000Z'),
      ],
      { now: new Date('2026-06-22T12:00:00.000Z') },
    )

    expect(buckets.map((bucket) => [bucket.label, bucket.rooms.map((item) => item.id)])).toEqual([
      ['Tomorrow', ['tomorrow']],
      ['Today', ['today']],
    ])
  })
})
