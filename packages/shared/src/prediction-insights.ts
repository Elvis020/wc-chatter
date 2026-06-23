import type { MatchStatus, Prediction, Room, RoomCurrentScore, RoomSummary } from './index.js'

export type Scoreline = {
  home: number
  away: number
}

export type RoomSplitCounts = {
  home: number
  draw: number
  away: number
}

export type RoomSplitPercentages = RoomSplitCounts

export type RoomReadoutInsight = {
  key: 'empty' | 'crowd' | 'winners' | 'split' | 'weather'
  icon: string
  label: string
  value: string
  detail: string
  caption: string
  tone: 'hot' | 'calm' | 'split' | 'sharp' | 'empty' | 'winner'
  crowd?: {
    pickCount: number
    total: number
    share: number
    predictorLabel: string
  }
  weather?: {
    picks: number
    comments: number
    likes: number
  }
  split?: {
    home: number
    draw: number
    away: number
    homeLabel: string
    awayLabel: string
  }
  winners?: {
    count: number
    names: string[]
    score: string
  }
}

export function predictionCommentTotal(prediction: Prediction) {
  return prediction.comments.reduce((sum, comment) => sum + 1 + comment.replies.length, 0)
}

export function roomCommentTotal(room: Pick<Room, 'predictions'>) {
  return room.predictions.reduce((sum, prediction) => sum + predictionCommentTotal(prediction), 0)
}

export function roomLikeTotal(room: Pick<Room, 'predictions'>) {
  return room.predictions.reduce((sum, prediction) => sum + prediction.likes, 0)
}

export function percentOf(value: number, total: number) {
  if (total <= 0) return 0
  return Math.round((value / total) * 100)
}

export function formatScoreMargin(homeName: string, awayName: string, homeScore: number, awayScore: number) {
  if (homeScore === awayScore) {
    return 'Draw backed most'
  }

  const side = homeScore > awayScore ? homeName : awayName
  const gap = Math.abs(homeScore - awayScore)
  return `${side} by ${gap}`
}

export function scoreKey(homeScore: number, awayScore: number) {
  return `${homeScore}-${awayScore}`
}

export function scoreLabel(room: Pick<Room, 'home' | 'away'>, homeScore: number, awayScore: number) {
  return `${room.home.code} ${homeScore}-${awayScore} ${room.away.code}`
}

export function buildMostBackedSummary(
  teams: { homeName: string; awayName: string },
  predictions: Prediction[],
): RoomSummary {
  if (predictions.length === 0) {
    return {
      home: 0,
      away: 0,
      margin: 'No picks yet',
    }
  }

  const backed = new Map<string, { home: number; away: number; count: number; likes: number; createdAt: string }>()
  for (const prediction of predictions) {
    const key = scoreKey(prediction.homeScore, prediction.awayScore)
    const existing = backed.get(key)
    if (existing) {
      existing.count += 1
      existing.likes += prediction.likes
      if (prediction.createdAt > existing.createdAt) existing.createdAt = prediction.createdAt
      continue
    }

    backed.set(key, {
      home: prediction.homeScore,
      away: prediction.awayScore,
      count: 1,
      likes: prediction.likes,
      createdAt: prediction.createdAt,
    })
  }

  const top = [...backed.values()].sort(
    (left, right) => right.count - left.count || right.likes - left.likes || right.createdAt.localeCompare(left.createdAt),
  )[0]

  return {
    home: top.home,
    away: top.away,
    margin: formatScoreMargin(teams.homeName, teams.awayName, top.home, top.away),
  }
}

export function scorelineCount(predictions: Prediction[], score: Scoreline) {
  const key = scoreKey(score.home, score.away)
  return predictions.filter((prediction) => scoreKey(prediction.homeScore, prediction.awayScore) === key).length
}

export function roomSplitCounts(room: Pick<Room, 'predictions'>): RoomSplitCounts {
  return room.predictions.reduce(
    (split, prediction) => {
      if (prediction.homeScore > prediction.awayScore) split.home += 1
      else if (prediction.homeScore < prediction.awayScore) split.away += 1
      else split.draw += 1
      return split
    },
    { home: 0, draw: 0, away: 0 },
  )
}

export function roomSplitPercentages(room: Pick<Room, 'predictions'>) {
  const counts = roomSplitCounts(room)
  const total = room.predictions.length

  return {
    counts,
    percentages: {
      home: percentOf(counts.home, total),
      draw: percentOf(counts.draw, total),
      away: percentOf(counts.away, total),
    },
  }
}

export function finalScoreForRoom(room?: Pick<Room, 'currentScore' | 'matchStatus'> | null, matchStatus?: MatchStatus) {
  if (!room || (matchStatus ?? room.matchStatus) !== 'finished') return null
  if (!room.currentScore || room.currentScore.status !== 'finished') return null
  return {
    home: room.currentScore.home,
    away: room.currentScore.away,
  }
}

export function isExactPick(prediction: Prediction, score?: Scoreline | null) {
  return !!score && prediction.homeScore === score.home && prediction.awayScore === score.away
}

export function prizeResultForScore(
  prediction: Prediction | Pick<Prediction, 'homeScore' | 'awayScore'>,
  score?: RoomCurrentScore | Scoreline | null,
) {
  if (!score) return 'pending'
  if ('status' in score && score.status !== 'finished') return 'pending'
  return prediction.homeScore === score.home && prediction.awayScore === score.away ? 'winner' : 'miss'
}

function uniqueNames(predictions: Prediction[]) {
  return [...new Set(predictions.map((prediction) => prediction.name.trim()).filter(Boolean))]
}

function formatWinnerNames(names: string[]) {
  const visible = names.slice(0, 4)
  const remaining = names.length - visible.length
  return `${visible.join(' · ')}${remaining > 0 ? ` · +${remaining} more` : ''}`
}

function predictorLabel(names: string[]) {
  if (names.length > 1) return `${names[0]} +${names.length - 1} predicted it`
  if (names[0]) return `${names[0]} predicted it`
  return 'Someone predicted it'
}

function banterWeatherInsight(room: Room): RoomReadoutInsight {
  const comments = roomCommentTotal(room)
  const likes = roomLikeTotal(room)
  const picks = room.predictions.length
  const heat = comments * 2 + likes
  const weather = { picks, comments, likes }

  if (heat >= 40) {
    return {
      key: 'weather',
      icon: '🌶️',
      label: 'Banter weather',
      value: 'Spicy',
      detail: `${picks} picks · ${comments} replies · ${likes} likes`,
      caption: 'Keep water nearby.',
      tone: 'hot',
      weather,
    }
  }

  if (heat >= 14) {
    return {
      key: 'weather',
      icon: '🌡️',
      label: 'Banter weather',
      value: 'Heating up',
      detail: `${picks} picks · ${comments} replies · ${likes} likes`,
      caption: comments > 0 ? 'Replies are stretching.' : 'Takes are warming up.',
      tone: 'sharp',
      weather,
    }
  }

  if (picks <= 1 && heat <= 2) {
    return {
      key: 'weather',
      icon: '🧊',
      label: 'Banter weather',
      value: 'Cold room',
      detail: `${picks} picks · ${comments} replies · ${likes} likes`,
      caption: 'First bold take gets the mic.',
      tone: 'calm',
      weather,
    }
  }

  return {
    key: 'weather',
    icon: '☁️',
    label: 'Banter weather',
    value: 'Calm',
    detail: `${picks} picks · ${comments} replies · ${likes} likes`,
    caption: 'Suspiciously polite.',
    tone: 'calm',
    weather,
  }
}

export function buildRoomReadoutInsights(room?: Room | null, options: { matchStatus?: MatchStatus } = {}): RoomReadoutInsight[] {
  if (!room || room.predictions.length === 0) {
    return [
      {
        key: 'empty',
        icon: '👀',
        label: 'Top pick',
        value: 'No top pick yet',
        detail: 'The room is waiting for the first brave score.',
        caption: 'Drop one and become the headline.',
        tone: 'empty',
      },
    ]
  }

  const total = room.predictions.length
  const mostBacked = buildMostBackedSummary(
    { homeName: room.home.name, awayName: room.away.name },
    room.predictions,
  )
  const topPickCount = scorelineCount(room.predictions, mostBacked)
  const topPickShare = percentOf(topPickCount, total)
  const topPickNames = uniqueNames(
    room.predictions.filter(
      (prediction) => prediction.homeScore === mostBacked.home && prediction.awayScore === mostBacked.away,
    ),
  )
  const { counts: split, percentages } = roomSplitPercentages(room)
  const finalScore = finalScoreForRoom(room, options.matchStatus)
  const winnerNames = finalScore ? uniqueNames(room.predictions.filter((prediction) => isExactPick(prediction, finalScore))) : []
  const winnerInsight: RoomReadoutInsight | null = finalScore && winnerNames.length
    ? {
        key: 'winners',
        icon: '🏆',
        label: winnerNames.length === 1 ? 'Winner' : 'Winners',
        value: winnerNames.length === 1 ? `${winnerNames[0]} nailed it` : `${winnerNames.length} nailed it`,
        detail: formatWinnerNames(winnerNames),
        caption: `Exact on ${scoreLabel(room, finalScore.home, finalScore.away)}`,
        tone: 'winner',
        winners: {
          count: winnerNames.length,
          names: winnerNames,
          score: scoreLabel(room, finalScore.home, finalScore.away),
        },
      }
    : null

  return [
    {
      key: 'crowd',
      icon: '📣',
      label: 'Crowd pick',
      value: scoreLabel(room, mostBacked.home, mostBacked.away),
      detail: `${topPickCount}/${total} picks · ${topPickShare}% of the room`,
      caption: mostBacked.margin,
      tone: topPickShare >= 50 ? 'sharp' : 'split',
      crowd: {
        pickCount: topPickCount,
        total,
        share: topPickShare,
        predictorLabel: predictorLabel(topPickNames),
      },
    },
    ...(winnerInsight ? [winnerInsight] : []),
    {
      key: 'split',
      icon: '⚖️',
      label: 'Room split',
      value: `${room.home.code} ${percentages.home}% · Draw ${percentages.draw}% · ${room.away.code} ${percentages.away}%`,
      detail: `${split.home} backing ${room.home.code} · ${split.draw} draw · ${split.away} backing ${room.away.code}`,
      caption: split.draw >= Math.max(split.home, split.away) ? 'The draw gang has entered the chat.' : 'The room has picked a direction.',
      tone: 'split',
      split: {
        home: percentages.home,
        draw: percentages.draw,
        away: percentages.away,
        homeLabel: room.home.code,
        awayLabel: room.away.code,
      },
    },
    banterWeatherInsight(room),
  ]
}
