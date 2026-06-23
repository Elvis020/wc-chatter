<script setup lang="ts">
import { subdivisionFlagIso2, type PrizeDeskEntry, type Team } from '@turntabl-score-room/shared'
import { computed, ref } from 'vue'
import { updatePrizePickupStatus } from '../lib/api'

type AdminPrizeFilter = 'all' | 'winner' | 'pending' | 'verified' | 'missing'

const props = defineProps<{
  entries: PrizeDeskEntry[]
  visibleEntries: PrizeDeskEntry[]
  selectedEntry: PrizeDeskEntry | null
  loading: boolean
  error: string
  filter: AdminPrizeFilter
  page: number
  pageCount: number
  rangeLabel: string
  winnerCount: number
  verifiedCount: number
  pendingCount: number
  missingPickupCount: number
}>()

const emit = defineEmits<{
  refresh: []
  'update:filter': [filter: AdminPrizeFilter]
  'update:page': [page: number]
  selectEntry: [entry: PrizeDeskEntry]
  closeEntry: []
  entryUpdated: [entry: PrizeDeskEntry]
}>()

const filters: AdminPrizeFilter[] = ['all', 'winner', 'pending', 'verified', 'missing']
const pickupDrawerEntry = ref<PrizeDeskEntry | null>(null)
const pickupDrawerTarget = ref(false)
const adminPassword = ref('')
const pickupSubmitting = ref(false)
const pickupError = ref('')
const pickupDrawerTitle = computed(() =>
  pickupDrawerTarget.value ? 'Mark prize collected' : 'Mark prize not collected',
)

function formatAdminDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function prizeEntryScore(entry: PrizeDeskEntry) {
  return `${entry.home.code} ${entry.predictedHomeScore}-${entry.predictedAwayScore} ${entry.away.code}`
}

function prizeEntryFinalScore(entry: PrizeDeskEntry) {
  if (!entry.finalScore) return 'Result pending'
  const prefix = entry.finalScore.status === 'finished' ? 'FT' : entry.finalScore.status === 'live' ? 'Live' : 'Score'
  return `${prefix} ${entry.finalScore.home}-${entry.finalScore.away}`
}

function hasPrizeEntryFinalScore(entry: PrizeDeskEntry) {
  return !!entry.finalScore
}

function prizeEntryStatusLabel(entry: PrizeDeskEntry) {
  if (entry.result === 'winner') return 'Exact winner'
  if (entry.result === 'miss') return 'Not exact'
  return entry.matchStatus === 'live' ? 'In play' : 'Pending'
}

function adminFilterCount(filter: AdminPrizeFilter) {
  if (filter === 'winner') return props.winnerCount
  if (filter === 'pending') return props.pendingCount
  if (filter === 'verified') return props.verifiedCount
  if (filter === 'missing') return props.missingPickupCount
  return props.entries.length
}

function adminFilterLabel(filter: AdminPrizeFilter) {
  return {
    all: 'All',
    winner: 'Winners',
    pending: 'Pending',
    verified: 'Pickup info',
    missing: 'Missing info',
  }[filter]
}

function adminPickupLabel(entry: PrizeDeskEntry) {
  return entry.pickup ? 'View pickup details' : 'No pickup details'
}

function adminPickupIconPath(entry: PrizeDeskEntry) {
  return entry.pickup
    ? 'M56 96V72a72 72 0 0 1 144 0v24M48 96h160v112H48zM128 144v24'
    : 'M56 96V72a72 72 0 0 1 124.8-48.9M208 96v112H48V96h112M32 32l192 192'
}

function canUpdateCollection(entry: PrizeDeskEntry) {
  return entry.result === 'winner' && !!entry.pickup
}

function hasCollectedPrize(entry: PrizeDeskEntry) {
  return !!entry.pickup?.pickedUpAt
}

function collectionLabel(entry: PrizeDeskEntry) {
  if (entry.result !== 'winner') return 'Not a winner'
  if (!entry.pickup) return 'Missing pickup info'
  return hasCollectedPrize(entry) ? 'Prize collected' : 'Mark prize collected'
}

function openPickupCollectionDrawer(entry: PrizeDeskEntry) {
  if (!canUpdateCollection(entry)) return
  pickupDrawerEntry.value = entry
  pickupDrawerTarget.value = !hasCollectedPrize(entry)
  adminPassword.value = ''
  pickupError.value = ''
}

function closePickupCollectionDrawer() {
  if (pickupSubmitting.value) return
  pickupDrawerEntry.value = null
  adminPassword.value = ''
  pickupError.value = ''
}

async function submitPickupCollection() {
  const entry = pickupDrawerEntry.value
  if (!entry || pickupSubmitting.value) return

  pickupSubmitting.value = true
  pickupError.value = ''

  try {
    const response = await updatePrizePickupStatus(entry.predictionId, {
      adminPassword: adminPassword.value,
      pickedUp: pickupDrawerTarget.value,
    })
    emit('entryUpdated', response.entry)
    pickupDrawerEntry.value = null
    adminPassword.value = ''
  } catch (error) {
    pickupError.value = error instanceof Error ? error.message : 'Unable to update pickup status.'
  } finally {
    pickupSubmitting.value = false
  }
}

function teamFlagIso2(team: Team) {
  return (team.iso2 || subdivisionFlagIso2(team.name, team.code)).toLowerCase()
}

function flagClass(team: Team) {
  return `flag fi fi-${teamFlagIso2(team)}`
}

function hasSpriteFlag(team: Team) {
  return !!teamFlagIso2(team)
}
</script>

<template>
  <section class="grid gap-4" aria-labelledby="admin-title">
    <div class="flex flex-wrap items-end justify-between gap-3 rounded-xl border border-[var(--line)] bg-[color:color-mix(in_srgb,var(--panel)_88%,transparent)] p-4">
      <div class="grid gap-1">
        <p class="m-0 text-[11px] font-extrabold uppercase tracking-[0.08em] text-[var(--accent)]">Admin</p>
        <h1 id="admin-title" class="m-0 text-2xl font-black leading-tight text-[var(--text)]">Configurations</h1>
        <p class="m-0 text-sm leading-snug text-[var(--muted)]">Manage the parts of Turntabl Score Room that need owner attention.</p>
      </div>
      <span class="rounded-md border border-[color:color-mix(in_srgb,var(--accent)_18%,var(--line))] bg-[color:color-mix(in_srgb,var(--accent)_7%,transparent)] px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-[0.06em] text-[var(--accent)]">Hidden route</span>
    </div>

    <section class="grid gap-2.5 md:grid-cols-3" aria-label="Admin configuration areas">
      <article class="grid gap-2 rounded-xl border border-[color:color-mix(in_srgb,var(--accent)_24%,var(--line))] bg-[color:color-mix(in_srgb,var(--accent)_7%,var(--panel))] p-4">
        <div class="flex items-center justify-between gap-2">
          <h2 class="m-0 text-base font-black text-[var(--text)]">Prize desk</h2>
          <span class="rounded-md bg-[var(--accent)] px-2 py-1 text-[10px] font-extrabold uppercase tracking-[0.06em] text-[var(--accent-text)]">Live</span>
        </div>
        <p class="m-0 text-sm leading-[1.45] text-[var(--soft)]">Review prediction outcomes and pickup verification.</p>
        <p class="m-0 text-xs font-bold text-[var(--muted)]">{{ entries.length }} predictions tracked</p>
      </article>

      <article class="grid gap-2 rounded-xl border border-[var(--line)] bg-[color:color-mix(in_srgb,var(--panel)_88%,transparent)] p-4">
        <div class="flex items-center justify-between gap-2">
          <h2 class="m-0 text-base font-black text-[var(--text)]">Room board</h2>
          <span class="rounded-md border border-[var(--line)] px-2 py-1 text-[10px] font-extrabold uppercase tracking-[0.06em] text-[var(--muted)]">Next</span>
        </div>
        <p class="m-0 text-sm leading-[1.45] text-[var(--soft)]">Create, close, archive, and refresh match rooms from the admin surface.</p>
      </article>

      <article class="grid gap-2 rounded-xl border border-[var(--line)] bg-[color:color-mix(in_srgb,var(--panel)_88%,transparent)] p-4">
        <div class="flex items-center justify-between gap-2">
          <h2 class="m-0 text-base font-black text-[var(--text)]">Visibility</h2>
          <span class="rounded-md border border-[var(--line)] px-2 py-1 text-[10px] font-extrabold uppercase tracking-[0.06em] text-[var(--muted)]">Next</span>
        </div>
        <p class="m-0 text-sm leading-[1.45] text-[var(--soft)]">Control what is public, draft, hidden, or ready for match-day traffic.</p>
      </article>
    </section>

    <section class="grid gap-3 rounded-xl border border-[var(--line)] bg-[color:color-mix(in_srgb,var(--panel)_88%,transparent)] p-4" aria-labelledby="prize-desk-title">
      <div class="flex flex-wrap items-end justify-between gap-3">
        <div class="grid gap-1">
          <p class="m-0 text-[11px] font-extrabold uppercase tracking-[0.08em] text-[var(--accent)]">Configuration</p>
          <h2 id="prize-desk-title" class="m-0 text-xl font-black leading-tight text-[var(--text)]">Prize desk</h2>
          <p class="m-0 text-sm leading-snug text-[var(--muted)]">Map predictions to final scores, then use pickup checks for exact winners.</p>
        </div>
        <button
          class="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-[color:color-mix(in_srgb,var(--accent)_28%,var(--line))] bg-[color:color-mix(in_srgb,var(--accent)_7%,var(--panel))] px-3.5 text-xs font-extrabold text-[var(--accent)] transition-[background-color,opacity,transform] duration-100 ease-[cubic-bezier(0.4,0,0.2,1)] hover:bg-[color:color-mix(in_srgb,var(--accent)_11%,var(--panel))] active:translate-y-px disabled:cursor-wait disabled:opacity-70 disabled:active:translate-y-0"
          type="button"
          :disabled="loading"
          @click="emit('refresh')"
        >
          <svg class="ph-icon h-4 w-4" :class="loading ? 'animate-spin' : ''" viewBox="0 0 256 256" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="18">
            <path d="M200 72v48h-48"></path>
            <path d="M56 184v-48h48"></path>
            <path d="M185.8 112A64 64 0 0 0 77 82.2L56 104"></path>
            <path d="M70.2 144A64 64 0 0 0 179 173.8L200 152"></path>
          </svg>
          <span>{{ loading ? 'Refreshing' : 'Refresh desk' }}</span>
        </button>
      </div>

      <div class="rounded-lg border border-[var(--line)] bg-[color:color-mix(in_srgb,var(--chip-bg)_24%,transparent)] p-2">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <span class="px-1 text-[10px] font-extrabold uppercase tracking-[0.08em] text-[var(--muted)]">Filter predictions</span>
          <div class="flex flex-wrap items-center gap-1" aria-label="Prize desk filters">
            <button
              v-for="filterOption in filters"
              :key="filterOption"
              class="inline-flex min-h-9 items-center gap-2 rounded-lg border px-3 text-[12px] font-extrabold transition-[background-color,border-color,color] duration-100 ease-[cubic-bezier(0.4,0,0.2,1)]"
              :class="filter === filterOption ? 'border-[color:color-mix(in_srgb,var(--accent)_46%,var(--line))] bg-[color:color-mix(in_srgb,var(--accent)_12%,var(--panel))] text-[var(--accent)] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--accent)_16%,transparent)]' : 'border-transparent bg-transparent text-[var(--soft)] hover:border-[var(--line)] hover:bg-[var(--panel)] hover:text-[var(--text)]'"
              type="button"
              @click="emit('update:filter', filterOption)"
            >
              <span>{{ adminFilterLabel(filterOption) }}</span>
              <span class="min-w-5 rounded-md px-1.5 py-0.5 text-center text-[10px] leading-none" :class="filter === filterOption ? 'bg-[color:color-mix(in_srgb,var(--accent)_14%,transparent)] text-[var(--accent)]' : 'bg-[color:color-mix(in_srgb,var(--text)_7%,transparent)] text-[var(--muted)]'">{{ adminFilterCount(filterOption) }}</span>
            </button>
          </div>
        </div>
      </div>

      <div v-if="loading && !entries.length" class="grid gap-2.5" aria-label="Loading prize desk">
        <div v-for="item in 3" :key="item" class="grid gap-2 rounded-lg border border-[var(--line)] bg-[color:color-mix(in_srgb,var(--chip-bg)_40%,transparent)] p-3">
          <div class="skeleton-pulse h-4 w-36 rounded-full"></div>
          <div class="grid gap-2 min-[720px]:grid-cols-3">
            <div class="skeleton-pulse h-10 rounded-lg"></div>
            <div class="skeleton-pulse h-10 rounded-lg"></div>
            <div class="skeleton-pulse h-10 rounded-lg"></div>
          </div>
        </div>
      </div>

      <div v-else-if="error" class="grid gap-3 rounded-lg border border-[color:color-mix(in_srgb,#d14343_28%,var(--line))] bg-[color:color-mix(in_srgb,#d14343_7%,var(--panel))] p-4 text-sm text-[var(--text)]">
        <strong class="text-[var(--danger)]">Could not load prize desk</strong>
        <p class="m-0 text-[var(--soft)]">{{ error }}</p>
      </div>

      <div v-else-if="!entries.length" class="grid min-h-[220px] place-items-center rounded-lg border border-[var(--line)] bg-[color:color-mix(in_srgb,var(--chip-bg)_36%,transparent)] p-8 text-center">
        <div class="grid max-w-[420px] gap-2">
          <h3 class="m-0 text-lg font-black text-[var(--text)]">No predictions yet</h3>
          <p class="m-0 text-sm leading-[1.5] text-[var(--muted)]">Every submitted prediction will appear here with result status and pickup verification.</p>
        </div>
      </div>

      <div v-else-if="!visibleEntries.length" class="grid min-h-[160px] place-items-center rounded-lg border border-[var(--line)] bg-[color:color-mix(in_srgb,var(--chip-bg)_30%,transparent)] p-6 text-center">
        <div class="grid gap-1">
          <h3 class="m-0 text-base font-black text-[var(--text)]">No rows for this filter</h3>
          <p class="m-0 text-sm text-[var(--muted)]">Try another filter to continue reviewing predictions.</p>
        </div>
      </div>

      <div v-else class="overflow-hidden rounded-lg border border-[var(--line)] bg-[color:color-mix(in_srgb,var(--chip-bg)_22%,transparent)]" aria-label="Prize desk predictions">
        <div class="overflow-x-auto">
          <table class="w-full min-w-[1040px] border-collapse text-left text-sm">
            <thead>
              <tr class="border-b border-[var(--line)] bg-[color:color-mix(in_srgb,var(--panel)_62%,transparent)] text-[10px] font-extrabold uppercase tracking-[0.07em] text-[var(--muted)]">
                <th class="px-3 py-2.5">User</th>
                <th class="px-3 py-2.5">Match</th>
                <th class="px-3 py-2.5">Prediction</th>
                <th class="px-3 py-2.5">Actual</th>
                <th class="px-3 py-2.5">Result</th>
                <th class="px-3 py-2.5">Pickup info</th>
                <th class="px-3 py-2.5">Collected</th>
                <th class="px-3 py-2.5">Submitted</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="entry in visibleEntries"
                :key="entry.id"
                class="h-[76px] border-b border-[color:color-mix(in_srgb,var(--line)_78%,transparent)] last:border-b-0 hover:bg-[color:color-mix(in_srgb,var(--accent)_5%,transparent)]"
              >
                <td class="px-3 py-3 align-middle">
                  <strong class="text-[13px] leading-tight text-[var(--text)]">{{ entry.authorName }}</strong>
                </td>
                <td class="px-3 py-3 align-middle">
                  <div class="inline-grid grid-cols-[52px_auto_52px] items-start gap-2" :aria-label="`${entry.home.name} versus ${entry.away.name}`">
                    <div class="grid justify-items-center gap-1">
                      <span v-if="hasSpriteFlag(entry.home)" :class="flagClass(entry.home)" class="!h-7 !w-10 rounded-[4px]" :title="entry.home.name" aria-hidden="true"></span>
                      <span v-else class="text-xs font-black text-[var(--text)]">{{ entry.home.code }}</span>
                      <span class="max-w-[52px] truncate text-center text-[10px] font-bold leading-tight text-[var(--muted)]">{{ entry.home.name }}</span>
                    </div>
                    <span class="pt-2 text-[10px] font-black uppercase tracking-[0.08em] text-[var(--muted)]">vs</span>
                    <div class="grid justify-items-center gap-1">
                      <span v-if="hasSpriteFlag(entry.away)" :class="flagClass(entry.away)" class="!h-7 !w-10 rounded-[4px]" :title="entry.away.name" aria-hidden="true"></span>
                      <span v-else class="text-xs font-black text-[var(--text)]">{{ entry.away.code }}</span>
                      <span class="max-w-[52px] truncate text-center text-[10px] font-bold leading-tight text-[var(--muted)]">{{ entry.away.name }}</span>
                    </div>
                  </div>
                </td>
                <td class="px-3 py-3 align-middle font-semibold text-[var(--text)]">{{ prizeEntryScore(entry) }}</td>
                <td class="px-3 py-3 align-middle">
                  <span
                    class="inline-flex rounded-md px-2 py-1 text-xs font-extrabold"
                    :class="hasPrizeEntryFinalScore(entry) ? 'bg-[color:color-mix(in_srgb,var(--accent)_8%,transparent)] text-[var(--text)]' : 'bg-[color:color-mix(in_srgb,var(--muted)_9%,transparent)] text-[var(--muted)]'"
                  >
                    {{ prizeEntryFinalScore(entry) }}
                  </span>
                </td>
                <td class="px-3 py-3 align-middle">
                  <span v-if="entry.result === 'pending'" class="inline-flex items-center gap-1.5 text-xs font-bold text-[var(--muted)]">
                    <span class="h-1.5 w-1.5 rounded-full bg-[color:color-mix(in_srgb,var(--muted)_58%,transparent)]" aria-hidden="true"></span>
                    Open
                  </span>
                  <span v-else-if="entry.result === 'winner'" class="inline-grid h-8 w-8 place-items-center rounded-full bg-[var(--accent)] text-[var(--accent-ink)] shadow-[0_8px_18px_color-mix(in_srgb,var(--accent)_20%,transparent)]" :aria-label="prizeEntryStatusLabel(entry)" role="img">
                    <svg class="h-4 w-4" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                      <path d="m5 10.5 3.2 3.1L15.5 6"></path>
                    </svg>
                  </span>
                  <span v-else class="inline-grid h-8 w-8 place-items-center rounded-full border border-[color:color-mix(in_srgb,var(--muted)_34%,var(--line))] bg-transparent text-[color:color-mix(in_srgb,var(--muted)_86%,var(--text))]" :aria-label="prizeEntryStatusLabel(entry)" role="img">
                    <svg class="h-3.5 w-3.5" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
                      <path d="M6 6l8 8M14 6l-8 8"></path>
                    </svg>
                  </span>
                </td>
                <td class="px-3 py-3 align-middle">
                  <button
                    v-if="entry.result === 'winner'"
                    class="inline-grid h-9 w-9 place-items-center rounded-lg border transition-[background-color,border-color,color,transform] duration-100 ease-[cubic-bezier(0.4,0,0.2,1)] hover:border-[color:color-mix(in_srgb,var(--accent)_32%,var(--line))] hover:bg-[color:color-mix(in_srgb,var(--accent)_8%,var(--panel))] active:translate-y-px"
                    :class="entry.pickup ? 'border-[color:color-mix(in_srgb,#15803d_30%,var(--line))] bg-[color:color-mix(in_srgb,#15803d_8%,var(--panel))] text-[#166534]' : 'border-[var(--line)] text-[var(--muted)]'"
                    type="button"
                    :aria-label="adminPickupLabel(entry)"
                    @click="emit('selectEntry', entry)"
                  >
                    <svg class="h-4 w-4" viewBox="0 0 256 256" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="18" stroke-linecap="round" stroke-linejoin="round">
                      <path :d="adminPickupIconPath(entry)"></path>
                    </svg>
                  </button>
                  <span v-else class="text-sm font-bold text-[var(--muted)]">-</span>
                </td>
                <td class="px-3 py-3 align-middle">
                  <button
                    v-if="entry.result === 'winner' && entry.pickup"
                    class="inline-flex min-h-9 items-center gap-2 rounded-lg border px-2.5 text-xs font-extrabold transition-[background-color,border-color,color,transform] duration-100 ease-[cubic-bezier(0.4,0,0.2,1)] hover:border-[color:color-mix(in_srgb,var(--accent)_32%,var(--line))] hover:bg-[color:color-mix(in_srgb,var(--accent)_8%,var(--panel))] active:translate-y-px"
                    :class="hasCollectedPrize(entry) ? 'border-[color:color-mix(in_srgb,#15803d_30%,var(--line))] bg-[color:color-mix(in_srgb,#15803d_8%,var(--panel))] text-[#166534]' : 'border-[var(--line)] text-[var(--muted)]'"
                    type="button"
                    :aria-label="collectionLabel(entry)"
                    @click="openPickupCollectionDrawer(entry)"
                  >
                    <svg class="h-4 w-4" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
                      <path v-if="hasCollectedPrize(entry)" d="m5 10.5 3.2 3.1L15.5 6"></path>
                      <path v-else d="M10 4v12M4 10h12"></path>
                    </svg>
                    <span>{{ hasCollectedPrize(entry) ? 'Collected' : 'Mark' }}</span>
                  </button>
                  <span v-else class="text-sm font-bold text-[var(--muted)]">-</span>
                </td>
                <td class="px-3 py-3 align-middle text-xs font-bold text-[var(--muted)]">{{ formatAdminDate(entry.createdAt) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--line)] bg-[color:color-mix(in_srgb,var(--panel)_46%,transparent)] px-3 py-2">
          <span class="text-xs font-bold text-[var(--muted)]">{{ rangeLabel }}</span>
          <div class="flex items-center gap-1.5">
            <button class="inline-flex min-h-8 items-center rounded-lg border border-[var(--line)] bg-[var(--panel)] px-3 text-xs font-extrabold text-[var(--soft)] transition-[background-color,border-color,color] duration-100 hover:border-[var(--line-strong)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-45" type="button" :disabled="page === 0" @click="emit('update:page', Math.max(0, page - 1))">
              Prev
            </button>
            <span class="min-w-14 text-center text-xs font-extrabold text-[var(--muted)]">{{ page + 1 }}/{{ pageCount }}</span>
            <button class="inline-flex min-h-8 items-center rounded-lg border border-[var(--line)] bg-[var(--panel)] px-3 text-xs font-extrabold text-[var(--soft)] transition-[background-color,border-color,color] duration-100 hover:border-[var(--line-strong)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-45" type="button" :disabled="page >= pageCount - 1" @click="emit('update:page', Math.min(pageCount - 1, page + 1))">
              Next
            </button>
          </div>
        </div>
      </div>
    </section>

    <Transition enter-active-class="transition-opacity duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]" leave-active-class="transition-opacity duration-150 ease-[cubic-bezier(0.4,0,1,1)]" enter-from-class="opacity-0" leave-to-class="opacity-0">
      <div v-if="selectedEntry" class="fixed inset-0 z-[1250] bg-black/35" role="presentation" @click.self="emit('closeEntry')">
        <Transition appear enter-active-class="transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]" leave-active-class="transition-transform duration-200 ease-[cubic-bezier(0.4,0,1,1)]" enter-from-class="translate-x-full" leave-to-class="translate-x-full">
          <aside class="ml-auto flex h-full w-[min(420px,calc(100%-24px))] flex-col border-l border-[var(--line-strong)] bg-[var(--panel)] p-4 shadow-[var(--card-shadow)]" role="dialog" aria-modal="true" aria-labelledby="pickup-detail-title">
            <div class="flex items-start justify-between gap-3 border-b border-[var(--line)] pb-3">
              <div class="grid gap-1">
                <p class="m-0 text-[10px] font-extrabold uppercase tracking-[0.08em] text-[var(--accent)]">Pickup detail</p>
                <h3 id="pickup-detail-title" class="m-0 text-xl font-black leading-tight text-[var(--text)]">{{ selectedEntry.authorName }}</h3>
                <p class="m-0 text-xs font-bold text-[var(--muted)]">{{ selectedEntry.roomTitle }}</p>
              </div>
              <button class="inline-grid h-10 w-10 place-items-center rounded-lg border border-[var(--line)] bg-[var(--chip-bg)] text-[var(--text)] hover:border-[var(--line-strong)]" type="button" aria-label="Close pickup detail" @click="emit('closeEntry')">
                <svg class="h-4 w-4" viewBox="0 0 256 256" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="18" stroke-linecap="round">
                  <path d="M72 72l112 112M184 72 72 184"></path>
                </svg>
              </button>
            </div>

            <div class="grid gap-3 overflow-auto py-4">
              <div class="grid grid-cols-2 gap-2">
                <div class="rounded-lg border border-[var(--line)] bg-[color:color-mix(in_srgb,var(--chip-bg)_28%,transparent)] p-3">
                  <span class="block text-[10px] font-extrabold uppercase tracking-[0.07em] text-[var(--muted)]">Prediction</span>
                  <strong class="mt-1 block text-sm text-[var(--text)]">{{ prizeEntryScore(selectedEntry) }}</strong>
                </div>
                <div class="rounded-lg border border-[var(--line)] bg-[color:color-mix(in_srgb,var(--chip-bg)_28%,transparent)] p-3">
                  <span class="block text-[10px] font-extrabold uppercase tracking-[0.07em] text-[var(--muted)]">Actual</span>
                  <strong class="mt-1 block text-sm text-[var(--text)]">{{ prizeEntryFinalScore(selectedEntry) }}</strong>
                </div>
              </div>

              <div class="rounded-lg border border-[var(--line)] bg-[color:color-mix(in_srgb,var(--chip-bg)_22%,transparent)] p-3">
                <span class="mb-2 inline-flex items-center gap-2 text-xs font-bold text-[var(--soft)]">
                  <span v-if="selectedEntry.result === 'winner'" class="inline-grid h-7 w-7 place-items-center rounded-full bg-[var(--accent)] text-[var(--accent-ink)]" aria-hidden="true">
                    <svg class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                      <path d="m5 10.5 3.2 3.1L15.5 6"></path>
                    </svg>
                  </span>
                  <span v-else-if="selectedEntry.result === 'miss'" class="inline-grid h-7 w-7 place-items-center rounded-full border border-[color:color-mix(in_srgb,var(--muted)_34%,var(--line))] text-[var(--muted)]" aria-hidden="true">
                    <svg class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
                      <path d="M6 6l8 8M14 6l-8 8"></path>
                    </svg>
                  </span>
                  <span v-else class="inline-block h-2 w-2 rounded-full bg-[color:color-mix(in_srgb,var(--muted)_58%,transparent)]" aria-hidden="true"></span>
                  {{ prizeEntryStatusLabel(selectedEntry) }}
                </span>
                <div class="grid gap-1 text-sm text-[var(--soft)]">
                  <p class="m-0"><strong class="text-[var(--text)]">Match:</strong> {{ selectedEntry.home.name }} vs {{ selectedEntry.away.name }}</p>
                  <p class="m-0"><strong class="text-[var(--text)]">Score provider:</strong> {{ selectedEntry.finalScore?.provider || 'No score provider yet' }}</p>
                  <p class="m-0"><strong class="text-[var(--text)]">Submitted:</strong> {{ formatAdminDate(selectedEntry.createdAt) }}</p>
                </div>
              </div>

              <div class="grid gap-2 rounded-lg border border-[var(--line)] bg-[color:color-mix(in_srgb,var(--panel)_72%,transparent)] p-3">
                <div class="flex items-center justify-between gap-2">
                  <span class="text-[10px] font-extrabold uppercase tracking-[0.07em] text-[var(--muted)]">Question and answer</span>
                  <span class="rounded-md px-2 py-1 text-[10px] font-extrabold uppercase tracking-[0.06em]" :class="selectedEntry.pickup ? 'bg-[color:color-mix(in_srgb,var(--accent)_10%,transparent)] text-[var(--accent)]' : 'bg-[color:color-mix(in_srgb,var(--muted)_10%,transparent)] text-[var(--muted)]'">{{ selectedEntry.pickup ? 'Provided' : 'Missing' }}</span>
                </div>
                <template v-if="selectedEntry.pickup">
                  <div class="grid gap-1">
                    <span class="text-[11px] font-extrabold uppercase tracking-[0.06em] text-[var(--muted)]">Question</span>
                    <p class="m-0 text-sm font-bold leading-snug text-[var(--text)]">{{ selectedEntry.pickup.question }}</p>
                  </div>
                  <div class="grid gap-1">
                    <span class="text-[11px] font-extrabold uppercase tracking-[0.06em] text-[var(--muted)]">Answer</span>
                    <p class="m-0 text-sm leading-snug text-[var(--soft)]">{{ selectedEntry.pickup.answer }}</p>
                  </div>
                </template>
                <p v-else class="m-0 text-sm leading-snug text-[var(--muted)]">This prediction has no pickup question saved, so admin cannot verify prize pickup from this browser setup.</p>
              </div>
            </div>
          </aside>
        </Transition>
      </div>
    </Transition>

    <Transition enter-active-class="transition-opacity duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]" leave-active-class="transition-opacity duration-150 ease-[cubic-bezier(0.4,0,1,1)]" enter-from-class="opacity-0" leave-to-class="opacity-0">
      <div
        v-if="pickupDrawerEntry"
        class="fixed inset-0 z-[1260] bg-black/35"
        role="presentation"
        @click.self="closePickupCollectionDrawer"
      >
        <Transition appear enter-active-class="transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]" leave-active-class="transition-transform duration-200 ease-[cubic-bezier(0.4,0,1,1)]" enter-from-class="translate-x-full" leave-to-class="translate-x-full">
          <aside class="ml-auto flex h-full w-[min(420px,calc(100%-24px))] flex-col border-l border-[var(--line-strong)] bg-[var(--panel)] p-4 shadow-[var(--card-shadow)]" role="dialog" aria-modal="true" aria-labelledby="pickup-collection-title">
            <div class="flex items-start justify-between gap-3 border-b border-[var(--line)] pb-3">
              <div class="grid gap-1">
                <p class="m-0 text-[10px] font-extrabold uppercase tracking-[0.08em] text-[var(--accent)]">Prize pickup</p>
                <h3 id="pickup-collection-title" class="m-0 text-xl font-black leading-tight text-[var(--text)]">{{ pickupDrawerTitle }}</h3>
                <p class="m-0 text-xs font-bold text-[var(--muted)]">{{ pickupDrawerEntry.authorName }} · {{ pickupDrawerEntry.roomTitle }}</p>
              </div>
              <button class="inline-grid h-10 w-10 place-items-center rounded-lg border border-[var(--line)] bg-[var(--chip-bg)] text-[var(--text)] hover:border-[var(--line-strong)] disabled:cursor-wait disabled:opacity-60" type="button" aria-label="Close prize pickup drawer" :disabled="pickupSubmitting" @click="closePickupCollectionDrawer">
                <svg class="h-4 w-4" viewBox="0 0 256 256" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="18" stroke-linecap="round">
                  <path d="M72 72l112 112M184 72 72 184"></path>
                </svg>
              </button>
            </div>

            <form class="grid gap-3 py-4" @submit.prevent="submitPickupCollection">
              <div class="rounded-lg border border-[var(--line)] bg-[color:color-mix(in_srgb,var(--chip-bg)_26%,transparent)] p-3 text-sm leading-snug text-[var(--soft)]">
                <strong class="block text-[var(--text)]">{{ prizeEntryScore(pickupDrawerEntry) }}</strong>
                <span>{{ pickupDrawerTarget ? 'Confirm this winner has collected their prize.' : 'Undo the collected mark for this winner.' }}</span>
              </div>

              <label class="grid gap-1.5 text-sm font-bold text-[var(--text)]" for="admin-pickup-password">
                Admin password
                <input
                  id="admin-pickup-password"
                  v-model="adminPassword"
                  class="min-h-11 w-full rounded-lg border border-[var(--control-border)] bg-[var(--control-bg)] px-3 text-base text-[var(--text)] outline-none focus:border-[color:color-mix(in_srgb,var(--accent)_46%,var(--control-border))] disabled:cursor-wait disabled:opacity-70"
                  type="password"
                  autocomplete="current-password"
                  :disabled="pickupSubmitting"
                  required
                />
              </label>

              <p v-if="pickupError" class="m-0 text-xs font-bold text-[var(--danger)]">{{ pickupError }}</p>

              <button
                class="inline-flex min-h-11 items-center justify-center rounded-lg bg-[var(--accent)] px-4 text-sm font-extrabold text-[var(--accent-text)] transition-[background-color,opacity,transform] duration-100 ease-[cubic-bezier(0.4,0,0.2,1)] hover:bg-[color:color-mix(in_srgb,var(--accent)_86%,black)] active:translate-y-px disabled:cursor-wait disabled:opacity-65 disabled:active:translate-y-0"
                type="submit"
                :disabled="pickupSubmitting || !adminPassword.trim()"
              >
                {{ pickupSubmitting ? 'Saving...' : pickupDrawerTarget ? 'Mark collected' : 'Mark not collected' }}
              </button>
            </form>
          </aside>
        </Transition>
      </div>
    </Transition>
  </section>
</template>
