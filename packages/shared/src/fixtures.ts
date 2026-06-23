import fixtureJson from './data/worldcup.json' with { type: 'json' }
import teamJson from './data/worldcup.teams.json' with { type: 'json' }
import type { MatchStatus, Team } from './index.js'

type RawFixture = {
  round: string
  date: string
  time?: string
  team1: string
  team2: string
  group?: string
  ground?: string
  score?: { ft?: [number, number] }
}

type RawTeam = {
  name: string
  fifa_code: string
  flag_unicode?: string
}

export type FixtureMatch = {
  id: string
  date: string
  time?: string
  round: string
  group: string
  venue: string
  homeName: string
  awayName: string
  home: Team
  away: Team
  result?: {
    homeGoals: number
    awayGoals: number
    status: 'FT'
  }
}

export type MatchCycleWindow = {
  cycleDate: string
  startUtc: string
  endUtc: string
  startHourUtc: number
}

export const DEFAULT_MATCH_CYCLE_START_HOUR_UTC = 4
export const MATCH_LIVE_DURATION_MS = 2 * 60 * 60 * 1000
const FLAG_ICON_SUBDIVISION_CODES = new Map<string, string>([
  ['England', 'gb-eng'],
  ['Northern Ireland', 'gb-nir'],
  ['Scotland', 'gb-sct'],
  ['Wales', 'gb-wls'],
])

const SEEDED_RESULTS = [
  { date: '2026-06-11', team1: 'Mexico', team2: 'South Africa', g1: 2, g2: 0 },
  { date: '2026-06-11', team1: 'South Korea', team2: 'Czech Republic', g1: 2, g2: 1 },
  { date: '2026-06-18', team1: 'Czech Republic', team2: 'South Africa', g1: 1, g2: 1 },
  { date: '2026-06-18', team1: 'Mexico', team2: 'South Korea', g1: 1, g2: 0 },
  { date: '2026-06-12', team1: 'Canada', team2: 'Bosnia & Herzegovina', g1: 1, g2: 1 },
  { date: '2026-06-13', team1: 'Qatar', team2: 'Switzerland', g1: 1, g2: 1 },
  { date: '2026-06-18', team1: 'Switzerland', team2: 'Bosnia & Herzegovina', g1: 4, g2: 1 },
  { date: '2026-06-18', team1: 'Canada', team2: 'Qatar', g1: 6, g2: 0 },
  { date: '2026-06-13', team1: 'Brazil', team2: 'Morocco', g1: 1, g2: 1 },
  { date: '2026-06-13', team1: 'Haiti', team2: 'Scotland', g1: 0, g2: 1 },
  { date: '2026-06-19', team1: 'Scotland', team2: 'Morocco', g1: 0, g2: 1 },
  { date: '2026-06-19', team1: 'Brazil', team2: 'Haiti', g1: 3, g2: 0 },
  { date: '2026-06-12', team1: 'USA', team2: 'Paraguay', g1: 4, g2: 1 },
  { date: '2026-06-13', team1: 'Australia', team2: 'Turkey', g1: 2, g2: 0 },
  { date: '2026-06-19', team1: 'USA', team2: 'Australia', g1: 2, g2: 0 },
  { date: '2026-06-19', team1: 'Turkey', team2: 'Paraguay', g1: 0, g2: 1 },
  { date: '2026-06-14', team1: 'Germany', team2: 'Curaçao', g1: 7, g2: 1 },
  { date: '2026-06-14', team1: 'Ivory Coast', team2: 'Ecuador', g1: 1, g2: 0 },
  { date: '2026-06-20', team1: 'Germany', team2: 'Ivory Coast', g1: 2, g2: 1 },
  { date: '2026-06-20', team1: 'Ecuador', team2: 'Curaçao', g1: 0, g2: 0 },
  { date: '2026-06-14', team1: 'Netherlands', team2: 'Japan', g1: 2, g2: 2 },
  { date: '2026-06-14', team1: 'Sweden', team2: 'Tunisia', g1: 5, g2: 1 },
  { date: '2026-06-20', team1: 'Netherlands', team2: 'Sweden', g1: 5, g2: 1 },
  { date: '2026-06-20', team1: 'Tunisia', team2: 'Japan', g1: 0, g2: 4 },
  { date: '2026-06-15', team1: 'Belgium', team2: 'Egypt', g1: 1, g2: 1 },
  { date: '2026-06-15', team1: 'Iran', team2: 'New Zealand', g1: 2, g2: 2 },
  { date: '2026-06-15', team1: 'Spain', team2: 'Cape Verde', g1: 0, g2: 0 },
  { date: '2026-06-15', team1: 'Saudi Arabia', team2: 'Uruguay', g1: 1, g2: 1 },
  { date: '2026-06-16', team1: 'France', team2: 'Senegal', g1: 3, g2: 1 },
  { date: '2026-06-16', team1: 'Iraq', team2: 'Norway', g1: 1, g2: 4 },
  { date: '2026-06-16', team1: 'Argentina', team2: 'Algeria', g1: 3, g2: 0 },
  { date: '2026-06-16', team1: 'Austria', team2: 'Jordan', g1: 3, g2: 1 },
  { date: '2026-06-17', team1: 'Portugal', team2: 'DR Congo', g1: 1, g2: 1 },
  { date: '2026-06-17', team1: 'Uzbekistan', team2: 'Colombia', g1: 1, g2: 3 },
  { date: '2026-06-17', team1: 'England', team2: 'Croatia', g1: 4, g2: 2 },
  { date: '2026-06-17', team1: 'Ghana', team2: 'Panama', g1: 1, g2: 0 },
]

export function subdivisionFlagIso2(name: string, code?: string): string {
  const fromName = FLAG_ICON_SUBDIVISION_CODES.get(name)
  if (fromName) return fromName

  const normalizedCode = code?.toUpperCase()
  if (normalizedCode === 'ENG') return 'gb-eng'
  if (normalizedCode === 'NIR') return 'gb-nir'
  if (normalizedCode === 'SCO') return 'gb-sct'
  if (normalizedCode === 'WAL' || normalizedCode === 'WLS') return 'gb-wls'

  return ''
}

function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function resultKey(date: string, home: string, away: string): string {
  return `${date}:${slugify(home)}:${slugify(away)}`
}

const seededResultsByFixture = new Map(
  SEEDED_RESULTS.map((result) => [resultKey(result.date, result.team1, result.team2), result]),
)

export function seededResultForFixture(date: string, homeName: string, awayName: string) {
  const seed = seededResultsByFixture.get(resultKey(date, homeName, awayName))
  if (!seed) return undefined
  return {
    homeGoals: seed.g1,
    awayGoals: seed.g2,
    status: 'FT' as const,
  }
}

function titleCaseToken(token: string): string {
  if (/^[A-Z0-9]{2,}$/.test(token)) return token
  return token.slice(0, 1).toUpperCase() + token.slice(1).toLowerCase()
}

function fallbackCode(name: string): string {
  const compact = name.replace(/[^A-Za-z0-9]/g, '')
  if (/^[A-Z0-9]{2,4}$/.test(compact)) {
    return compact.slice(0, 4).toUpperCase()
  }

  const tokens = name
    .split(/[^A-Za-z0-9]+/)
    .map((token) => token.trim())
    .filter(Boolean)
  const initials = tokens.map((token) => titleCaseToken(token)[0]).join('')
  if (initials.length >= 2) {
    return initials.slice(0, 3).toUpperCase()
  }

  return compact.slice(0, 3).toUpperCase() || 'TBD'
}

function decodeFlagUnicode(value?: string): string {
  if (!value) return ''
  return value.replace(/\\u\{([0-9a-fA-F]+)\}/g, (_, hex: string) =>
    String.fromCodePoint(Number.parseInt(hex, 16)),
  )
}

function emojiFlagToIso2(flag: string): string {
  const codePoints = Array.from(flag).map((char) => char.codePointAt(0) ?? 0)
  if (codePoints.length !== 2) return ''
  const offset = 0x1f1e6
  const letters = codePoints.map((codePoint) => codePoint - offset)
  if (letters.some((value) => value < 0 || value > 25)) return ''
  return String.fromCharCode(65 + letters[0], 65 + letters[1])
}

function buildKnownTeams(): Map<string, Team> {
  return new Map(
    (teamJson as RawTeam[]).map((raw) => {
      const flag = decodeFlagUnicode(raw.flag_unicode)
      const iso2 = subdivisionFlagIso2(raw.name, raw.fifa_code) || emojiFlagToIso2(flag)
      return [
        raw.name,
        {
          name: raw.name,
          code: raw.fifa_code,
          iso2,
          flag,
        } satisfies Team,
      ]
    }),
  )
}

const knownTeams = buildKnownTeams()

function toTeam(name: string): Team {
  return (
    knownTeams.get(name) ?? {
      name,
      code: fallbackCode(name),
      iso2: '',
      flag: '',
    }
  )
}

function toMatchId(raw: RawFixture, index: number): string {
  return `${raw.date}-${index + 1}-${slugify(raw.team1)}-${slugify(raw.team2)}`
}

function parseResult(raw: RawFixture): FixtureMatch['result'] | undefined {
  if (!raw.score?.ft) return seededResultForFixture(raw.date, raw.team1, raw.team2)
  return {
    homeGoals: raw.score.ft[0],
    awayGoals: raw.score.ft[1],
    status: 'FT',
  }
}

export function loadFixtures(): FixtureMatch[] {
  return ((fixtureJson as { matches: RawFixture[] }).matches ?? []).map((raw, index) => ({
    id: toMatchId(raw, index),
    date: raw.date,
    time: raw.time,
    round: raw.round,
    group: raw.group?.replace(/^Group\s+/, '') ?? 'Knockout',
    venue: raw.ground ?? 'TBD',
    homeName: raw.team1,
    awayName: raw.team2,
    home: toTeam(raw.team1),
    away: toTeam(raw.team2),
    result: parseResult(raw),
  }))
}

export function createFixtureKickoffLookup(matches: FixtureMatch[] = loadFixtures()): Map<string, string> {
  return new Map(
    matches.flatMap((match) => {
      const kickoff = matchKickoffUtc(match)
      return [
        [match.id, kickoff],
        [`${match.home.code}-${match.away.code}`, kickoff],
      ]
    }),
  )
}

function dateKeyUtc(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function assertCycleStartHour(startHourUtc: number) {
  if (!Number.isInteger(startHourUtc) || startHourUtc < 0 || startHourUtc > 23) {
    throw new Error(`Match cycle start hour must be an integer from 0 to 23. Received: ${startHourUtc}`)
  }
}

export function matchKickoffUtc(match: Pick<FixtureMatch, 'date' | 'time'>): string {
  const [year, month, day] = match.date.split('-').map(Number)
  const time = match.time?.match(/^(\d{1,2}):(\d{2})\s+UTC([+-]\d{1,2})$/)
  if (!time) return new Date(Date.UTC(year, month - 1, day, 0, 0, 0)).toISOString()

  const [, hourText, minuteText, offsetText] = time
  const hour = Number(hourText)
  const minute = Number(minuteText)
  const offset = Number(offsetText)
  return new Date(Date.UTC(year, month - 1, day, hour - offset, minute, 0)).toISOString()
}

export function matchKickoffUtcMs(match: Pick<FixtureMatch, 'date' | 'time'>): number {
  return Date.parse(matchKickoffUtc(match))
}

export function matchStatusAt(match: FixtureMatch, now = new Date()): MatchStatus {
  const kickoffMs = matchKickoffUtcMs(match)
  const nowMs = now.getTime()
  if (nowMs < kickoffMs) return 'upcoming'
  if (nowMs <= kickoffMs + MATCH_LIVE_DURATION_MS) return 'live'
  return 'finished'
}

export function matchCycleDateForKickoff(
  kickoff: Date | string | number,
  startHourUtc = DEFAULT_MATCH_CYCLE_START_HOUR_UTC,
): string {
  assertCycleStartHour(startHourUtc)
  const date = new Date(kickoff)
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid kickoff date: ${kickoff}`)
  const shifted = new Date(date.getTime() - startHourUtc * 60 * 60 * 1000)
  return dateKeyUtc(shifted)
}

export function matchCycleWindowForKickoff(
  kickoff: Date | string | number,
  startHourUtc = DEFAULT_MATCH_CYCLE_START_HOUR_UTC,
): MatchCycleWindow {
  const cycleDate = matchCycleDateForKickoff(kickoff, startHourUtc)
  const [year, month, day] = cycleDate.split('-').map(Number)
  if (!year || !month || !day) throw new Error(`Invalid cycle date: ${cycleDate}`)
  const start = new Date(Date.UTC(year, month - 1, day, startHourUtc, 0, 0))
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1)
  return {
    cycleDate,
    startUtc: start.toISOString(),
    endUtc: end.toISOString(),
    startHourUtc,
  }
}

export function upcomingMatches(matches: FixtureMatch[], now = new Date()): FixtureMatch[] {
  const nowMs = now.getTime()
  return matches
    .filter((match) => matchKickoffUtcMs(match) >= nowMs)
    .sort((left, right) => matchKickoffUtcMs(left) - matchKickoffUtcMs(right))
}

export function nextCycleMatches(
  matches: FixtureMatch[],
  now = new Date(),
  startHourUtc = DEFAULT_MATCH_CYCLE_START_HOUR_UTC,
  cycleCount = 1,
): FixtureMatch[] {
  if (cycleCount <= 0) return []

  const upcoming = upcomingMatches(matches, now)
  const includedCycleDates = new Set<string>()
  const selected: FixtureMatch[] = []

  for (const match of upcoming) {
    const cycleDate = matchCycleDateForKickoff(matchKickoffUtc(match), startHourUtc)
    if (!includedCycleDates.has(cycleDate)) {
      if (includedCycleDates.size >= cycleCount) break
      includedCycleDates.add(cycleDate)
    }
    selected.push(match)
  }

  return selected
}

export function currentOrNextCycleMatches(
  matches: FixtureMatch[],
  now = new Date(),
  startHourUtc = DEFAULT_MATCH_CYCLE_START_HOUR_UTC,
  cycleCount = 1,
): FixtureMatch[] {
  const activeWindow = matchCycleWindowForKickoff(now, startHourUtc)
  const activeStartMs = Date.parse(activeWindow.startUtc)
  const activeEndMs = Date.parse(activeWindow.endUtc)
  const activeMatches = matches
    .filter((match) => {
      const kickoffMs = matchKickoffUtcMs(match)
      return kickoffMs >= activeStartMs && kickoffMs <= activeEndMs
    })
    .sort((left, right) => matchKickoffUtcMs(left) - matchKickoffUtcMs(right))

  if (activeMatches.length === 0) {
    return nextCycleMatches(matches, now, startHourUtc, cycleCount)
  }

  if (cycleCount <= 1) return activeMatches

  const additionalMatches = nextCycleMatches(matches, now, startHourUtc, cycleCount).filter(
    (match) => matchCycleDateForKickoff(matchKickoffUtc(match), startHourUtc) !== activeWindow.cycleDate,
  )

  return [...activeMatches, ...additionalMatches]
}
