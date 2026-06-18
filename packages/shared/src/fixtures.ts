import fixtureJson from './data/worldcup.json' with { type: 'json' }
import teamJson from './data/worldcup.teams.json' with { type: 'json' }
import type { Team } from './index.js'

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

function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
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
      const iso2 = emojiFlagToIso2(flag)
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
  if (!raw.score?.ft) return undefined
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
    .filter((match) => match.result?.status !== 'FT' && matchKickoffUtcMs(match) >= nowMs)
    .sort((left, right) => matchKickoffUtcMs(left) - matchKickoffUtcMs(right))
}

export function nextCycleMatches(
  matches: FixtureMatch[],
  now = new Date(),
  startHourUtc = DEFAULT_MATCH_CYCLE_START_HOUR_UTC,
): FixtureMatch[] {
  const upcoming = upcomingMatches(matches, now)
  const window = upcoming[0]
    ? matchCycleWindowForKickoff(matchKickoffUtc(upcoming[0]), startHourUtc)
    : undefined
  if (!window) return []

  const startMs = Date.parse(window.startUtc)
  const endMs = Date.parse(window.endUtc)
  return upcoming.filter((match) => {
    const kickoffMs = matchKickoffUtcMs(match)
    return kickoffMs >= startMs && kickoffMs <= endMs
  })
}

export function currentOrNextCycleMatches(
  matches: FixtureMatch[],
  now = new Date(),
  startHourUtc = DEFAULT_MATCH_CYCLE_START_HOUR_UTC,
): FixtureMatch[] {
  const activeWindow = matchCycleWindowForKickoff(now, startHourUtc)
  const activeStartMs = Date.parse(activeWindow.startUtc)
  const activeEndMs = Date.parse(activeWindow.endUtc)
  const activeMatches = matches
    .filter((match) => {
      if (match.result?.status === 'FT') return false
      const kickoffMs = matchKickoffUtcMs(match)
      return kickoffMs >= activeStartMs && kickoffMs <= activeEndMs
    })
    .sort((left, right) => matchKickoffUtcMs(left) - matchKickoffUtcMs(right))

  return activeMatches.length > 0 ? activeMatches : nextCycleMatches(matches, now, startHourUtc)
}
