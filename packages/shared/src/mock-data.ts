import {
  currentOrNextCycleMatches,
  loadFixtures,
  matchKickoffUtcMs,
  type FixtureMatch,
  type Prediction,
  type Room,
  type RoomStatus,
} from './index.js'

function isoOffset(minutesAgo: number) {
  return new Date(Date.now() - minutesAgo * 60_000).toISOString()
}

function hashSeed(seed: string) {
  return Array.from(seed).reduce((hash, char) => ((hash << 5) - hash + char.charCodeAt(0)) | 0, 0)
}

function formatMargin(homeName: string, awayName: string, homeScore: number, awayScore: number) {
  if (homeScore === awayScore) {
    return 'Draw backed most'
  }

  const side = homeScore > awayScore ? homeName : awayName
  const gap = Math.abs(homeScore - awayScore)
  return `${side} by ${gap}`
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
        text: commentTemplates[index] ?? 'Posting this before the group chat steals it.',
        replies: [],
      },
    ],
  }))
}

function roomStatus(match: FixtureMatch, now = new Date()): RoomStatus {
  if (match.result?.status === 'FT') return 'archived'
  return matchKickoffUtcMs(match) <= now.getTime() ? 'live' : 'upcoming'
}

function roomFromMatch(match: FixtureMatch, now = new Date()): Room {
  const predictions = seedPredictions(match)
  const [topPrediction] = predictions

  return {
    id: match.id,
    status: roomStatus(match, now),
    matchStatus: match.result?.status === 'FT' ? 'finished' : matchKickoffUtcMs(match) <= now.getTime() ? 'live' : 'upcoming',
    roomStatus: 'open',
    isFeatured: matchKickoffUtcMs(match) <= now.getTime(),
    home: match.home,
    away: match.away,
    mostBacked: {
      home: topPrediction?.homeScore ?? 0,
      away: topPrediction?.awayScore ?? 0,
      margin: topPrediction
        ? formatMargin(match.home.name, match.away.name, topPrediction.homeScore, topPrediction.awayScore)
        : 'No picks yet',
    },
    predictions,
  }
}

export function createMockRooms(): Room[] {
  const now = new Date()
  const fixtures = loadFixtures()
  const cycleMatches = currentOrNextCycleMatches(fixtures, now)

  if (cycleMatches.length > 0) {
    return cycleMatches.map((match) => roomFromMatch(match, now))
  }

  return fixtures
    .sort((left, right) => matchKickoffUtcMs(right) - matchKickoffUtcMs(left))
    .slice(0, 4)
    .reverse()
    .map((match) => roomFromMatch(match, now))
}
