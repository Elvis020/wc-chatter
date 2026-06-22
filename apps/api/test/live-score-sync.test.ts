import { describe, expect, test } from 'bun:test'
import type { LiveScorelineProvider } from '../src/live-score-providers'
import { syncLiveRoomScores } from '../src/live-score-sync'

const argentinaAustriaSlug = '2026-06-22-57-argentina-austria'

class FakeSupabase {
  updates: Array<Record<string, unknown>> = []

  constructor(private readonly rooms: Array<Record<string, unknown>>) {}

  from(table: string) {
    if (table !== 'rooms') throw new Error(`Unexpected table: ${table}`)

    return {
      select: () => ({
        in: (_column: string, slugs: string[]) => ({
          data: this.rooms.filter((room) => slugs.includes(String(room.slug))),
          error: null,
        }),
      }),
      update: (values: Record<string, unknown>) => ({
        eq: (column: string, value: unknown) => ({
          select: () => {
            const matched = this.rooms.filter((room) => room[column] === value)
            this.updates.push(...matched.map((room) => ({ slug: room.slug, ...values })))
            return {
              data: matched.map((room) => ({ slug: room.slug })),
              error: null,
            }
          },
          data: [],
          error: null,
        }),
      }),
    }
  }
}

const finishedScoreProvider: LiveScorelineProvider = {
  name: 'test-provider',
  async fetchScorelines() {
    return [
      {
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
      },
    ]
  },
}

describe('live score sync', () => {
  test('backfills a recently finished room after the normal live score window expires', async () => {
    const supabase = new FakeSupabase([
      {
        slug: argentinaAustriaSlug,
        status: 'archived',
        room_status: 'closed',
        current_home_score: null,
        current_away_score: null,
        score_status: null,
      },
    ])

    const result = await syncLiveRoomScores(supabase as any, {
      now: new Date('2026-06-22T21:30:00.000Z'),
      provider: finishedScoreProvider,
    })

    expect(result.updated).toBe(1)
    expect(supabase.updates).toContainEqual(
      expect.objectContaining({
        slug: argentinaAustriaSlug,
        match_status: 'finished',
        current_home_score: 2,
        current_away_score: 0,
        score_status: 'finished',
        score_clock: 'FT',
        score_provider: 'test-provider',
      }),
    )
  })

  test('does not rewrite a backfill room that already has a finished score', async () => {
    const supabase = new FakeSupabase([
      {
        slug: argentinaAustriaSlug,
        status: 'archived',
        room_status: 'closed',
        current_home_score: 2,
        current_away_score: 0,
        score_status: 'finished',
      },
    ])

    const result = await syncLiveRoomScores(supabase as any, {
      now: new Date('2026-06-22T21:30:00.000Z'),
      provider: finishedScoreProvider,
    })

    expect(result.updated).toBe(0)
    expect(supabase.updates).toEqual([])
  })
})
