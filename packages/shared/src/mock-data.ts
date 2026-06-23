import {
  fallbackLatestMatches,
  loadFixtures,
  matchKickoffUtc,
  matchStatusAt,
  selectRoomSlateMatches,
  type FixtureMatch,
  type Prediction,
  type Room,
  type RoomStatus,
} from './index.js'
import { buildMostBackedSummary } from './prediction-insights.js'

function isoOffset(minutesAgo: number) {
  return new Date(Date.now() - minutesAgo * 60_000).toISOString()
}

function hashSeed(seed: string) {
  return Array.from(seed).reduce((hash, char) => ((hash << 5) - hash + char.charCodeAt(0)) | 0, 0)
}

function scoreVariants(match: FixtureMatch) {
  const bias = Math.abs(hashSeed(match.id)) % 6
  return [
    [1 + (bias % 2), 1],
    [2, 1 + (bias % 2)],
    [1, 0 + (bias % 2)],
  ]
}

function seedPredictions(match: FixtureMatch): Prediction[] {
  const names = ['Kojo', 'Ama', 'Nadia']
  const commentTemplates = [
    'This room will get loud early.',
    'I trust the midfield more than the headlines.',
    'This score feels brave enough to post.',
  ]

  return scoreVariants(match).map(([homeScore, awayScore], index) => ({
    id: `prediction-${match.id}-${index + 1}`,
    authorId: `seed-${match.id}-${index + 1}`,
    name: names[index] ?? `Seed ${index + 1}`,
    homeScore,
    awayScore,
    likes: 10 + ((Math.abs(hashSeed(`${match.id}-${index}`)) % 9) * 2),
    createdAt: isoOffset(18 + index * 11),
    comments: [
      {
        id: `comment-${match.id}-${index + 1}`,
        authorId: `seed-${match.id}-${index + 1}`,
        name: names[index] ?? `Seed ${index + 1}`,
        text: commentTemplates[index] ?? 'Posting this before the group chat steals it.',
        replies: [],
        createdAt: isoOffset(17 + index * 11),
      },
    ],
  }))
}

function roomStatus(match: FixtureMatch, now = new Date()): RoomStatus {
  const matchStatus = matchStatusAt(match, now)
  if (matchStatus === 'finished') return 'archived'
  return matchStatus === 'live' ? 'live' : 'upcoming'
}

function roomFromMatch(match: FixtureMatch, now = new Date()): Room {
  const predictions = seedPredictions(match)
  const matchStatus = matchStatusAt(match, now)
  const kickoffAt = matchKickoffUtc(match)

  return {
    id: match.id,
    status: roomStatus(match, now),
    matchStatus,
    roomStatus: 'open',
    kickoffAt,
    isFeatured: matchStatus === 'live',
    currentScore: matchStatus === 'finished' && match.result
      ? {
          home: match.result.homeGoals,
          away: match.result.awayGoals,
          status: 'finished',
          clock: match.result.status,
          provider: 'fixture seed',
          updatedAt: kickoffAt,
        }
      : undefined,
    home: match.home,
    away: match.away,
    mostBacked: buildMostBackedSummary(
      { homeName: match.home.name, awayName: match.away.name },
      predictions,
    ),
    predictions,
  }
}

export function createMockRooms(): Room[] {
  const now = new Date()
  const fixtures = loadFixtures()
  const cycleMatches = selectRoomSlateMatches(fixtures, { now })

  if (cycleMatches.length > 0) {
    return cycleMatches.map((match) => roomFromMatch(match, now))
  }

  return fallbackLatestMatches(fixtures).map((match) => roomFromMatch(match, now))
}
