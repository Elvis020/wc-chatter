export type ThemeId = 'paper' | 'desk' | 'pub' | 'press'

export interface ThemeOption {
  id: ThemeId
  label: string
}

export interface Team {
  name: string
  code: string
  iso2: string
  flag: string
}

export type RoomStatus = 'upcoming' | 'live' | 'archived'
export type MatchStatus = 'upcoming' | 'live' | 'finished'
export type RoomInteractionStatus = 'open' | 'closed' | 'hidden'

export interface Reply {
  id: string
  authorId: string
  name: string
  text: string
  createdAt: string
  editedAt?: string
}

export interface Comment {
  id: string
  authorId?: string
  name: string
  text: string
  replies: Reply[]
  createdAt: string
  editedAt?: string
}

export interface Prediction {
  id: string
  authorId?: string
  name: string
  homeScore: number
  awayScore: number
  likes: number
  comments: Comment[]
  createdAt: string
  editedAt?: string
}

export interface RoomSummary {
  home: number
  away: number
  margin: string
}

export type RoomScoreStatus = 'scheduled' | 'live' | 'finished' | 'unknown'

export interface RoomCurrentScore {
  home: number
  away: number
  status: RoomScoreStatus
  clock: string
  provider: string
  updatedAt: string
}

export interface Room {
  id: string
  status: RoomStatus
  matchStatus: MatchStatus
  roomStatus: RoomInteractionStatus
  kickoffAt?: string
  isFeatured: boolean
  currentScore?: RoomCurrentScore
  home: Team
  away: Team
  mostBacked: RoomSummary
  predictions: Prediction[]
}

export interface BootstrapResponse {
  rooms: Room[]
  themes: ThemeOption[]
  generatedAt: string
}

export interface CreatePredictionInput {
  authorId: string
  name: string
  homeScore: number
  awayScore: number
  comment?: string
  prizeQuestion?: string
  prizeAnswer?: string
}

export interface PrizeClaim {
  id: string
  roomId: string
  predictionId: string
  authorId: string
  authorName: string
  question: string
  answer: string
  createdAt: string
}

export type PrizeDeskResult = 'winner' | 'miss' | 'pending'

export interface PrizeDeskEntry {
  id: string
  roomId: string
  roomTitle: string
  matchStatus: MatchStatus
  home: Team
  away: Team
  finalScore?: RoomCurrentScore
  predictionId: string
  authorId?: string
  authorName: string
  predictedHomeScore: number
  predictedAwayScore: number
  createdAt: string
  result: PrizeDeskResult
  pickup?: {
    claimId: string
    question: string
    answer: string
    createdAt: string
  }
}

export interface ReplyInput {
  authorId: string
  name: string
  text: string
}

export interface PredictionCommentInput {
  authorId: string
  name: string
  text: string
}

export interface UpdatePredictionInput {
  userId: string
  comment: string
}

export interface UpdateReplyInput {
  userId: string
  text: string
}

export interface ToggleLikeInput {
  userId: string
  liked: boolean
}

export type TypingTarget = 'reply'

export interface TypingEvent {
  type: 'typing'
  roomId: string
  userId: string
  name: string
  target: TypingTarget
  targetId: string
  active: boolean
  at: string
}

export type ApiEvent =
  | { type: 'bootstrap'; room: Room }
  | { type: 'room.updated'; room: Room }
  | TypingEvent

export const mockThemes: ThemeOption[] = [
  { id: 'paper', label: 'Paper Notes' },
  { id: 'desk', label: 'Sky Desk' },
  { id: 'pub', label: 'Grape Room' },
  { id: 'press', label: 'Coral Friday' },
]

export {
  DEFAULT_MATCH_CYCLE_START_HOUR_UTC,
  currentOrNextCycleMatches,
  loadFixtures,
  matchCycleDateForKickoff,
  matchCycleWindowForKickoff,
  matchKickoffUtc,
  matchKickoffUtcMs,
  matchStatusAt,
  nextCycleMatches,
  seededResultForFixture,
  subdivisionFlagIso2,
  upcomingMatches,
  MATCH_LIVE_DURATION_MS,
  type FixtureMatch,
  type MatchCycleWindow,
} from './fixtures.js'

export {
  buildMostBackedSummary,
  buildRoomReadoutInsights,
  finalScoreForRoom,
  formatScoreMargin,
  isExactPick,
  predictionCommentTotal,
  prizeResultForScore,
  roomCommentTotal,
  roomLikeTotal,
  roomSplitPercentages,
  scoreLabel,
  type RoomReadoutInsight,
  type Scoreline,
} from './prediction-insights.js'

export {
  DEFAULT_ROOM_SLATE_CYCLE_COUNT,
  fallbackLatestMatches,
  fixtureCycleKey,
  groupRoomsByCycle,
  roomBucketLabel,
  roomCycleDateKey,
  roomCycleStartMs,
  selectRoomSlateMatches,
  type RoomDayBucket,
} from './room-slate.js'

export {
  compareRoomsForSwitcher,
  effectiveRoomMatchStatus,
  isRoomLocked,
  matchStatusFromKickoff,
  roomKickoffIso,
  roomKickoffMs,
  roomKickoffTime,
  roomLockedAtMs,
  type FixtureKickoffLookup,
} from './room-state.js'
