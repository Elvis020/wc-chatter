import { describe, expect, test } from 'bun:test'
import { loadFixtures } from '@turntabl-score-room/shared'
import { selectSyncMatches } from '../src/room-sync'

describe('room sync slate selection', () => {
  test('syncs old played rooms plus today and tomorrow from the active Round of 32', () => {
    const matches = selectSyncMatches(loadFixtures(), new Date('2026-06-29T17:30:00.000Z'))

    expect(matches.map((match) => match.id)).toEqual([
      '2026-06-28-73-2a-2b',
      '2026-06-29-76-1c-2f',
      '2026-06-29-74-1e-3a-b-c-d-f',
      '2026-06-29-75-1f-2c',
      '2026-06-30-78-2e-2i',
      '2026-06-30-77-1i-3c-d-f-g-h',
      '2026-06-30-79-1a-3c-e-f-h-i',
    ])
    expect(matches.every((match) => match.round === 'Round of 32')).toBe(true)
    expect(matches.map((match) => `${match.homeName} vs ${match.awayName}`)).toEqual([
      'South Africa vs Canada',
      'Brazil vs Japan',
      'Germany vs Paraguay',
      'Netherlands vs Morocco',
      'Ivory Coast vs Norway',
      'France vs Sweden',
      'Mexico vs Ecuador',
    ])
  })
})
