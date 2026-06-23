import { type SupabaseClient } from '@supabase/supabase-js'
import {
  loadFixtures,
} from '@turntabl-score-room/shared'
import {
  EspnWorldCupApiProvider,
  MergedLiveScorelineProvider,
  type LiveScorelineProvider,
  WorldCup26ApiProvider,
} from './live-score-providers.js'
import {
  buildScoreRoomUpdate,
  legacyRoomStatus,
  LIVE_WINDOW_AFTER_MS,
  LIVE_WINDOW_BEFORE_MS,
  selectLiveScoreCandidates,
  type ScoreRoomRow,
  type ScoreRoomUpdate,
} from './live-score-policy.js'
import { ApiError } from './errors.js'

export type LiveScoreSyncResult = {
  checked: boolean
  candidateRooms: number
  scorelines: number
  updated: number
  dryRun?: boolean
  reason?: string
}

function isMissingColumnError(error?: { code?: string } | null) {
  return error?.code === 'PGRST204' || error?.code === '42703'
}

async function getExistingRooms(supabase: SupabaseClient, slugs: string[]) {
  if (slugs.length === 0) return new Map<string, ScoreRoomRow>()

  let response: any = await supabase
    .from('rooms')
    .select('slug, status, room_status, current_home_score, current_away_score, score_status')
    .in('slug', slugs)

  if (isMissingColumnError(response.error)) {
    response = await supabase
      .from('rooms')
      .select('slug, status')
      .in('slug', slugs)
  }

  if (response.error) {
    throw new ApiError('INTERNAL_ERROR', 'Unable to read rooms before live score sync.', 500)
  }

  return new Map(((response.data ?? []) as ScoreRoomRow[]).map((room) => [room.slug, room]))
}

async function updateExistingRooms(
  supabase: SupabaseClient,
  rows: Array<{ slug: string } & Record<string, unknown>>,
) {
  const updated: Array<{ slug: string }> = []

  for (const row of rows) {
    const { slug, ...values } = row
    const { data, error } = await supabase
      .from('rooms')
      .update(values)
      .eq('slug', slug)
      .select('slug')

    if (error) {
      return { data: updated, error }
    }

    updated.push(...((data ?? []) as Array<{ slug: string }>))
  }

  return { data: updated, error: null }
}

export async function syncLiveRoomScores(
  supabase: SupabaseClient,
  options: { now?: Date; provider?: LiveScorelineProvider; dryRun?: boolean } = {},
): Promise<LiveScoreSyncResult> {
  const now = options.now ?? new Date()
  const { candidates, liveWindowSlugs } = selectLiveScoreCandidates(loadFixtures(), now)

  if (candidates.length === 0) {
    return {
      checked: false,
      candidateRooms: 0,
      scorelines: 0,
      updated: 0,
      reason: 'No fixtures are inside the live score window.',
    }
  }

  const provider =
    options.provider ??
    new MergedLiveScorelineProvider([
      new EspnWorldCupApiProvider(),
      new WorldCup26ApiProvider(),
    ])
  const scorelines = await provider.fetchScorelines()
  const existingRooms = await getExistingRooms(supabase, candidates.map((match) => match.id))

  const rows = candidates
    .map((match) =>
      buildScoreRoomUpdate(match, existingRooms.get(match.id), scorelines, {
        now,
        isBackfillOnly: !liveWindowSlugs.has(match.id),
      }),
    )
    .filter((row): row is ScoreRoomUpdate => Boolean(row))

  const featuredSlug = rows.find((row) => row.match_status === 'live')?.slug
  const upserts = rows.map((row) => ({
    ...row,
    is_featured: row.slug === featuredSlug,
  }))

  if (upserts.length === 0) {
    return {
      checked: true,
      candidateRooms: candidates.length,
      scorelines: scorelines.length,
      updated: 0,
      dryRun: options.dryRun,
      reason: 'No synced rooms matched the live score window fixtures.',
    }
  }

  if (options.dryRun) {
    return {
      checked: true,
      candidateRooms: candidates.length,
      scorelines: scorelines.length,
      updated: 0,
      dryRun: true,
    }
  }

  await supabase.from('rooms').update({ is_featured: false }).eq('is_featured', true)

  let response: any = await updateExistingRooms(supabase, upserts)

  if (isMissingColumnError(response.error)) {
    console.warn('Live score sync is using room-state columns without score columns. Apply the scoreline migration and reload Supabase/PostgREST schema.')
    response = await updateExistingRooms(
      supabase,
      upserts.map(({ slug, status, match_status, room_status, is_featured }) => ({
        slug,
        status,
        match_status,
        room_status,
        is_featured,
      })),
    )
  }

  if (isMissingColumnError(response.error)) {
    console.warn('Live score sync is using legacy room status only. Apply room visibility migrations and reload Supabase/PostgREST schema.')
    response = await updateExistingRooms(
      supabase,
      upserts.map(({ slug, status }) => ({ slug, status })),
    )
  }

  if (response.error) {
    console.error('Supabase error', {
      operation: 'syncLiveRoomScores',
      code: response.error.code,
      message: response.error.message,
      details: response.error.details,
      hint: response.error.hint,
    })
    throw new ApiError('INTERNAL_ERROR', 'Unable to sync live room scores.', 500)
  }

  return {
    checked: true,
    candidateRooms: candidates.length,
    scorelines: scorelines.length,
    updated: response.data?.length ?? 0,
  }
}

export const liveScoreSyncWindow = {
  beforeMs: LIVE_WINDOW_BEFORE_MS,
  afterMs: LIVE_WINDOW_AFTER_MS,
}
