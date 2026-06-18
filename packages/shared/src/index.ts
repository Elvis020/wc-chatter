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
}

export interface Comment {
  id: string
  authorId?: string
  text: string
  replies: Reply[]
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
}

export interface RoomSummary {
  home: number
  away: number
  margin: string
}

export interface Room {
  id: string
  status: RoomStatus
  matchStatus: MatchStatus
  roomStatus: RoomInteractionStatus
  isFeatured: boolean
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
}

export interface ReplyInput {
  authorId: string
  name: string
  text: string
}

export interface ToggleLikeInput {
  userId: string
  liked: boolean
}

export type ApiEvent =
  | { type: 'bootstrap'; room: Room }
  | { type: 'room.updated'; room: Room }

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
  nextCycleMatches,
  upcomingMatches,
  type FixtureMatch,
  type MatchCycleWindow,
} from './fixtures.js'
