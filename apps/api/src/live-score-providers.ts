import type { RoomScoreStatus } from '@turntabl-score-room/shared'

export type LiveScoreline = {
  provider: string
  externalId: string
  date: string
  group: string
  homeName: string
  awayName: string
  homeGoals: number
  awayGoals: number
  status: RoomScoreStatus
  clock: string
  updatedAt: string
}

export type LiveScorelineProvider = {
  name: string
  fetchScorelines(): Promise<LiveScoreline[]>
}

type WorldCup26Game = {
  id: string
  home_score: string | number | null
  away_score: string | number | null
  group: string
  local_date: string
  finished: string | boolean
  time_elapsed: string
  home_team_name_en?: string
  away_team_name_en?: string
}

type EspnScoreboard = {
  events?: EspnEvent[]
}

type EspnEvent = {
  id: string
  date: string
  status?: EspnStatus
  competitions?: Array<{
    competitors?: EspnCompetitor[]
  }>
}

type EspnStatus = {
  displayClock?: string
  type?: {
    state?: string
    completed?: boolean
    detail?: string
    shortDetail?: string
    name?: string
  }
}

type EspnCompetitor = {
  homeAway: 'home' | 'away'
  score?: string
  team?: {
    displayName?: string
    name?: string
  }
}

function toNumber(value: string | number | null | undefined): number {
  if (typeof value === 'number') return value
  if (!value) return 0
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function cacheBusted(endpoint: string): string {
  const url = new URL(endpoint)
  url.searchParams.set('_', String(Date.now()))
  return url.toString()
}

function toIsoDate(localDate: string): string {
  const [datePart] = localDate.split(' ')
  const [month, day, year] = datePart.split('/')
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
}

function hasConcreteTeams(game: WorldCup26Game): game is WorldCup26Game & {
  home_team_name_en: string
  away_team_name_en: string
} {
  return Boolean(game.local_date && game.home_team_name_en && game.away_team_name_en)
}

function worldCup26Status(game: WorldCup26Game): RoomScoreStatus {
  const elapsed = String(game.time_elapsed ?? '').toLowerCase()
  const finished = String(game.finished ?? '').toLowerCase() === 'true'
  if (finished || elapsed === 'finished') return 'finished'
  if (elapsed && elapsed !== 'notstarted' && elapsed !== 'not started') return 'live'
  return 'scheduled'
}

export class WorldCup26ApiProvider implements LiveScorelineProvider {
  name = 'worldcup26.ir'

  constructor(private readonly endpoint = 'https://worldcup26.ir/get/games') {}

  async fetchScorelines(): Promise<LiveScoreline[]> {
    const response = await fetch(cacheBusted(this.endpoint), { cache: 'no-store' })
    if (!response.ok) throw new Error(`WorldCup26 API failed with ${response.status}`)
    const payload = (await response.json()) as { games?: WorldCup26Game[] }
    const updatedAt = new Date().toISOString()

    return (payload.games ?? [])
      .filter(hasConcreteTeams)
      .map((game) => ({
        provider: this.name,
        externalId: String(game.id),
        date: toIsoDate(game.local_date),
        group: game.group,
        homeName: game.home_team_name_en,
        awayName: game.away_team_name_en,
        homeGoals: toNumber(game.home_score),
        awayGoals: toNumber(game.away_score),
        status: worldCup26Status(game),
        clock: game.time_elapsed || 'unknown',
        updatedAt,
      }))
  }
}

function espnStatus(status?: EspnStatus): RoomScoreStatus {
  if (status?.type?.completed) return 'finished'
  if (status?.type?.state === 'in') return 'live'
  return 'scheduled'
}

function espnTeamName(competitor: EspnCompetitor | undefined): string | undefined {
  return competitor?.team?.displayName ?? competitor?.team?.name
}

export class EspnWorldCupApiProvider implements LiveScorelineProvider {
  name = 'espn:fifa.world'

  constructor(private readonly endpoint = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard') {}

  async fetchScorelines(): Promise<LiveScoreline[]> {
    const response = await fetch(cacheBusted(this.endpoint), { cache: 'no-store' })
    if (!response.ok) throw new Error(`ESPN World Cup API failed with ${response.status}`)
    const payload = (await response.json()) as EspnScoreboard
    const updatedAt = new Date().toISOString()

    return (payload.events ?? [])
      .map((event) => {
        const competitors = event.competitions?.[0]?.competitors ?? []
        const home = competitors.find((competitor) => competitor.homeAway === 'home')
        const away = competitors.find((competitor) => competitor.homeAway === 'away')
        const homeName = espnTeamName(home)
        const awayName = espnTeamName(away)
        if (!homeName || !awayName) return undefined

        return {
          provider: this.name,
          externalId: event.id,
          date: event.date.slice(0, 10),
          group: 'World Cup',
          homeName,
          awayName,
          homeGoals: toNumber(home?.score),
          awayGoals: toNumber(away?.score),
          status: espnStatus(event.status),
          clock: event.status?.type?.shortDetail ?? event.status?.displayClock ?? event.status?.type?.detail ?? 'unknown',
          updatedAt,
        } satisfies LiveScoreline
      })
      .filter((scoreline): scoreline is LiveScoreline => Boolean(scoreline))
  }
}

function normalizeTeamKey(name: string): string {
  const aliases: Record<string, string> = {
    'bosnia-herzegovina': 'bosnia-and-herzegovina',
    'czechia': 'czech-republic',
    'congo-dr': 'dr-congo',
    'cote-d-ivoire': 'ivory-coast',
  }

  const key = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return aliases[key] ?? key
}

function scorelineMergeKey(scoreline: LiveScoreline): string {
  return `${normalizeTeamKey(scoreline.homeName)}:${normalizeTeamKey(scoreline.awayName)}`
}

function statusRank(status: RoomScoreStatus): number {
  return {
    live: 3,
    finished: 2,
    scheduled: 1,
    unknown: 0,
  }[status]
}

export class MergedLiveScorelineProvider implements LiveScorelineProvider {
  name: string

  constructor(private readonly providers: LiveScorelineProvider[]) {
    this.name = providers.map((provider) => provider.name).join('+')
  }

  async fetchScorelines(): Promise<LiveScoreline[]> {
    const settled = await Promise.allSettled(this.providers.map((provider) => provider.fetchScorelines()))
    const merged = new Map<string, LiveScoreline>()
    const errors: string[] = []

    settled.forEach((result, index) => {
      const provider = this.providers[index]
      if (result.status === 'rejected') {
        errors.push(`${provider.name}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`)
        return
      }

      for (const scoreline of result.value) {
        const key = scorelineMergeKey(scoreline)
        const existing = merged.get(key)
        if (!existing || statusRank(scoreline.status) > statusRank(existing.status)) {
          merged.set(key, scoreline)
        }
      }
    })

    if (!merged.size && errors.length) throw new Error(`All live score providers failed: ${errors.join('; ')}`)
    return [...merged.values()]
  }
}

export function scorelineKeyForNames(homeName: string, awayName: string): string {
  return `${normalizeTeamKey(homeName)}:${normalizeTeamKey(awayName)}`
}
