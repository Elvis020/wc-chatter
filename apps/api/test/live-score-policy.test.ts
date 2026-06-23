import { describe, expect, test } from 'bun:test'
import { loadFixtures, type FixtureMatch } from '@turntabl-score-room/shared'
import {
  buildScoreRoomUpdate,
  scorelineMatch,
  selectLiveScoreCandidates,
  type ScoreRoomRow,
} from '../src/live-score-policy'
import type { LiveScoreline } from '../src/live-score-providers'

const argentinaAustriaSlug = '2026-06-22-57-argentina-austria'
const argentinaAustria = loadFixtures().find((match) => match.id === argentinaAustriaSlug) as FixtureMatch

const room: ScoreRoomRow = {
  slug: argentinaAustriaSlug,
  status: 'draft',
  room_status: 'open',
  current_home_score: null,
  current_away_score: null,
  score_status: null,
}

const finishedScoreline: LiveScoreline = {
  provider: 'test-provider',
  externalId: 'arg-aut',
  date: '2026-06-22',
  group: 'J',
  homeName: 'Argentina',
  awayName: 'Austria',
  homeGoals: 2,
  awayGoals: 0,
  status: 'finished',
  clock: 'FT',
  updatedAt: '2026-06-22T19:00:00.000Z',
}

describe('live score policy', () => {
  test('selects fixtures in the live score window', () => {
    const result = selectLiveScoreCandidates(loadFixtures(), new Date('2026-06-22T18:50:00.000Z'))

    expect(result.candidates.map((match) => match.id)).toContain(argentinaAustriaSlug)
    expect(result.liveWindowSlugs.has(argentinaAustriaSlug)).toBe(true)
  })

  test('matches scorelines by date and normalized teams', () => {
    expect(scorelineMatch(finishedScoreline, argentinaAustria)).toBe(true)
    expect(scorelineMatch({ ...finishedScoreline, date: '2026-06-23' }, argentinaAustria)).toBe(true)
    expect(scorelineMatch({ ...finishedScoreline, awayName: 'Brazil' }, argentinaAustria)).toBe(false)
  })

  test('builds a finished row update and skips already-finished backfills', () => {
    expect(
      buildScoreRoomUpdate(argentinaAustria, room, [finishedScoreline], {
        now: new Date('2026-06-22T21:30:00.000Z'),
        isBackfillOnly: true,
      }),
    ).toEqual(
      expect.objectContaining({
        slug: argentinaAustriaSlug,
        status: 'archived',
        match_status: 'finished',
        current_home_score: 2,
        current_away_score: 0,
        score_status: 'finished',
      }),
    )

    expect(
      buildScoreRoomUpdate(
        argentinaAustria,
        { ...room, current_home_score: 2, current_away_score: 0, score_status: 'finished' },
        [finishedScoreline],
        {
          now: new Date('2026-06-22T21:30:00.000Z'),
          isBackfillOnly: true,
        },
      ),
    ).toBeNull()
  })
})
