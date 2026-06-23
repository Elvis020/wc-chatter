import { describe, expect, test } from 'bun:test'
import {
  createFixtureKickoffLookup,
  currentOrNextCycleMatches,
  nextCycleMatches,
  type FixtureMatch,
} from '../src/index'

function fixture(id: string, date: string, time: string): FixtureMatch {
  return {
    id,
    date,
    time,
    round: 'Group stage',
    group: 'A',
    venue: 'TBD',
    homeName: `${id}-home`,
    awayName: `${id}-away`,
    home: { name: `${id}-home`, code: 'HME', iso2: '', flag: '' },
    away: { name: `${id}-away`, code: 'AWY', iso2: '', flag: '' },
  }
}

describe('fixture cycle selection', () => {
  test('returns every upcoming match in the first upcoming cycle by default', () => {
    const matches = [
      fixture('first', '2026-06-12', '04:00 UTC+0'),
      fixture('second', '2026-06-12', '14:00 UTC+0'),
      fixture('third', '2026-06-12', '23:00 UTC+0'),
      fixture('next-cycle', '2026-06-13', '04:00 UTC+0'),
    ]

    const rows = nextCycleMatches(matches, new Date('2026-06-12T03:40:00.000Z'))

    expect(rows.map((match) => match.id)).toEqual(['first', 'second', 'third'])
  })

  test('can return two upcoming cycle windows', () => {
    const matches = [
      fixture('first', '2026-06-12', '04:00 UTC+0'),
      fixture('second', '2026-06-12', '14:00 UTC+0'),
      fixture('third', '2026-06-12', '23:00 UTC+0'),
      fixture('next-cycle-a', '2026-06-13', '04:00 UTC+0'),
      fixture('next-cycle-b', '2026-06-13', '18:00 UTC+0'),
      fixture('later', '2026-06-14', '07:00 UTC+0'),
    ]

    const rows = nextCycleMatches(matches, new Date('2026-06-12T03:40:00.000Z'), undefined, 2)

    expect(rows.map((match) => match.id)).toEqual([
      'first',
      'second',
      'third',
      'next-cycle-a',
      'next-cycle-b',
    ])
  })

  test('can return the active cycle plus the next cycle window', () => {
    const matches = [
      fixture('late', '2026-06-15', '22:00 UTC+0'),
      fixture('overnight', '2026-06-16', '01:00 UTC+0'),
      fixture('next', '2026-06-16', '18:00 UTC+0'),
      fixture('next-late', '2026-06-17', '02:00 UTC+0'),
      fixture('later', '2026-06-17', '18:00 UTC+0'),
    ]

    const rows = currentOrNextCycleMatches(matches, new Date('2026-06-15T08:00:00.000Z'), undefined, 2)

    expect(rows.map((match) => match.id)).toEqual(['late', 'overnight', 'next', 'next-late'])
  })

  test('builds kickoff lookup entries by fixture id and team-code pairing', () => {
    const matches = [fixture('first', '2026-06-12', '14:00 UTC+0')]

    const lookup = createFixtureKickoffLookup(matches)

    expect(lookup.get('first')).toBe('2026-06-12T14:00:00.000Z')
    expect(lookup.get('HME-AWY')).toBe('2026-06-12T14:00:00.000Z')
  })
})
