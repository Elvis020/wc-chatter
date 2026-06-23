import { describe, expect, test } from 'bun:test'
import {
  buildMostBackedSummary,
  buildRoomReadoutInsights,
  isExactPick,
  predictionCommentTotal,
  prizeResultForScore,
  roomSplitPercentages,
  type Prediction,
  type Room,
} from '../src/index'

const basePrediction: Prediction = {
  id: 'prediction-1',
  authorId: 'user-1',
  name: 'Ama',
  homeScore: 2,
  awayScore: 1,
  likes: 0,
  createdAt: '2026-06-22T10:00:00.000Z',
  comments: [],
}

const baseRoom: Room = {
  id: 'room-1',
  status: 'upcoming',
  matchStatus: 'upcoming',
  roomStatus: 'open',
  kickoffAt: '2026-06-22T19:00:00.000Z',
  isFeatured: false,
  home: { name: 'USA', code: 'USA', iso2: 'US', flag: '🇺🇸' },
  away: { name: 'Australia', code: 'AUS', iso2: 'AU', flag: '🇦🇺' },
  mostBacked: { home: 0, away: 0, margin: 'No picks yet' },
  predictions: [],
}

function prediction(overrides: Partial<Prediction>): Prediction {
  return {
    ...basePrediction,
    ...overrides,
    comments: overrides.comments ?? basePrediction.comments,
  }
}

function room(predictions: Prediction[], overrides: Partial<Room> = {}): Room {
  return {
    ...baseRoom,
    ...overrides,
    home: { ...baseRoom.home, ...overrides.home },
    away: { ...baseRoom.away, ...overrides.away },
    predictions,
  }
}

describe('prediction insights', () => {
  test('chooses most-backed score by count, then likes, then recency', () => {
    const predictions = [
      prediction({ id: 'one', homeScore: 1, awayScore: 0, likes: 1, createdAt: '2026-06-22T10:00:00.000Z' }),
      prediction({ id: 'two', homeScore: 1, awayScore: 0, likes: 0, createdAt: '2026-06-22T10:01:00.000Z' }),
      prediction({ id: 'three', homeScore: 2, awayScore: 1, likes: 99, createdAt: '2026-06-22T10:02:00.000Z' }),
    ]

    expect(buildMostBackedSummary({ homeName: 'USA', awayName: 'Australia' }, predictions)).toEqual({
      home: 1,
      away: 0,
      margin: 'USA by 1',
    })
  })

  test('builds split percentages and comment totals at the room boundary', () => {
    const first = prediction({
      id: 'first',
      homeScore: 2,
      awayScore: 1,
      comments: [
        {
          id: 'comment-1',
          authorId: 'user-1',
          name: 'Ama',
          text: 'I like this.',
          createdAt: '2026-06-22T10:03:00.000Z',
          replies: [
            {
              id: 'reply-1',
              authorId: 'user-2',
              name: 'Kojo',
              text: 'Same.',
              createdAt: '2026-06-22T10:04:00.000Z',
            },
          ],
        },
      ],
    })
    const second = prediction({ id: 'second', homeScore: 1, awayScore: 1 })
    const third = prediction({ id: 'third', homeScore: 0, awayScore: 1 })

    expect(predictionCommentTotal(first)).toBe(2)
    expect(roomSplitPercentages(room([first, second, third]))).toEqual({
      counts: { home: 1, draw: 1, away: 1 },
      percentages: { home: 33, draw: 33, away: 33 },
    })
  })

  test('adds winner readout only when the final score is finished', () => {
    const predictions = [
      prediction({ id: 'winner', name: 'Nadia', homeScore: 2, awayScore: 1 }),
      prediction({ id: 'miss', name: 'Kojo', homeScore: 1, awayScore: 1 }),
    ]
    const finishedRoom = room(predictions, {
      matchStatus: 'finished',
      currentScore: {
        home: 2,
        away: 1,
        status: 'finished',
        clock: 'FT',
        provider: 'test',
        updatedAt: '2026-06-22T21:00:00.000Z',
      },
    })

    expect(isExactPick(predictions[0], { home: 2, away: 1 })).toBe(true)
    expect(prizeResultForScore(predictions[0], finishedRoom.currentScore)).toBe('winner')
    expect(buildRoomReadoutInsights(finishedRoom).map((insight) => insight.key)).toEqual([
      'crowd',
      'winners',
      'split',
      'weather',
    ])

    expect(
      buildRoomReadoutInsights({
        ...finishedRoom,
        matchStatus: 'live',
        currentScore: { ...finishedRoom.currentScore!, status: 'live' },
      }).some((insight) => insight.key === 'winners'),
    ).toBe(false)
  })
})
