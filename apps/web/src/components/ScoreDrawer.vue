<script setup lang="ts">
import type { Room } from '@wc-chatter/shared'

defineProps<{
  open: boolean
  room: Room | null
  submitting: boolean
  canSubmit: boolean
  closed: boolean
}>()

const emit = defineEmits<{
  close: []
  submit: []
}>()

const homeScore = defineModel<number>('homeScore', { required: true })
const awayScore = defineModel<number>('awayScore', { required: true })
const comment = defineModel<string>('comment', { required: true })
</script>

<template>
  <Transition name="sheet-flow">
    <div v-if="open && room" class="sheet-overlay fixed inset-0 z-[1200] grid items-end bg-black/50 p-[env(safe-area-inset-top)_env(safe-area-inset-right)_env(safe-area-inset-bottom)_env(safe-area-inset-left)]" aria-hidden="false" @click.self="submitting ? undefined : emit('close')">
      <section class="sheet-panel mx-auto mb-[max(10px,env(safe-area-inset-bottom))] flex h-fit max-h-[min(86dvh,calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom)-18px))] w-[min(760px,calc(100%-20px))] flex-col overflow-auto rounded-xl border border-[var(--line-strong)] bg-[var(--panel)] p-[18px] shadow-[var(--card-shadow)]" role="dialog" aria-modal="true" :aria-labelledby="`sheet-title-${room.id}`">
        <div class="sheet-stagger mb-3 flex items-start justify-between gap-3" style="--sheet-index: 0">
          <h2 class="m-0 text-xl font-extrabold leading-tight max-md:text-[18px]" :id="`sheet-title-${room.id}`">Your {{ room.home.name }} vs {{ room.away.name }} score</h2>
          <button class="inline-flex min-h-10 w-10 min-w-10 items-center justify-center rounded-lg border border-[var(--line)] bg-[var(--chip-bg)] p-0 text-[var(--muted)] transition-[background-color,border-color,transform] duration-100 ease-[cubic-bezier(0.4,0,0.2,1)] hover:border-[color:color-mix(in_srgb,var(--line)_82%,black)] hover:bg-[color:color-mix(in_srgb,var(--chip-bg)_88%,black)] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50 disabled:active:translate-y-0" type="button" aria-label="Close" :disabled="submitting" @click="emit('close')">
            <svg class="ph-icon h-5 w-5" viewBox="0 0 256 256" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="18">
              <path d="M200 56 56 200"></path>
              <path d="M56 56l144 144"></path>
            </svg>
          </button>
        </div>

        <form class="sheet-stagger" style="--sheet-index: 1" :aria-busy="submitting" @submit.prevent="emit('submit')">
          <p v-if="closed" class="mb-3 rounded-lg border border-[color:color-mix(in_srgb,var(--accent)_22%,var(--line))] bg-[color:color-mix(in_srgb,var(--accent)_7%,var(--panel))] px-3 py-2 text-sm font-bold leading-snug text-[color:color-mix(in_srgb,var(--accent)_74%,var(--text))]">
            Predictions are closed for this room.
          </p>
          <div class="grid grid-cols-2 gap-2.5 max-md:grid-cols-1">
            <div class="grid gap-1.5">
              <label class="text-xs font-bold text-[var(--muted)]" for="home-score">{{ room.home.name }}</label>
              <input id="home-score" v-model.number="homeScore" class="min-h-10 w-full rounded-lg border border-[var(--control-border)] bg-[var(--control-bg)] px-[11px] text-[var(--text)] outline-none disabled:cursor-not-allowed disabled:opacity-60 md:min-h-11" type="number" min="0" max="20" :disabled="submitting || closed" required />
            </div>
            <div class="grid gap-1.5">
              <label class="text-xs font-bold text-[var(--muted)]" for="away-score">{{ room.away.name }}</label>
              <input id="away-score" v-model.number="awayScore" class="min-h-10 w-full rounded-lg border border-[var(--control-border)] bg-[var(--control-bg)] px-[11px] text-[var(--text)] outline-none disabled:cursor-not-allowed disabled:opacity-60 md:min-h-11" type="number" min="0" max="20" :disabled="submitting || closed" required />
            </div>
          </div>

          <div class="mt-2.5 grid gap-2">
            <div class="grid gap-1.5">
              <label class="text-xs font-bold text-[var(--muted)]" for="take">Comment <span class="font-semibold text-[var(--muted)] opacity-70">(optional)</span></label>
              <textarea id="take" v-model="comment" class="max-h-20 min-h-16 w-full resize-none overflow-y-auto rounded-lg border border-[var(--control-border)] bg-[var(--control-bg)] px-3 py-2.5 text-[var(--text)] outline-none disabled:cursor-not-allowed disabled:opacity-60 max-md:min-h-14" rows="2" maxlength="280" placeholder="Add a little confidence..." :disabled="submitting || closed"></textarea>
            </div>
            <button class="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-[var(--accent)] px-[14px] text-[13px] font-extrabold text-[var(--accent-text)] transition-[background-color,transform,opacity] duration-100 ease-[cubic-bezier(0.4,0,0.2,1)] hover:bg-[color:color-mix(in_srgb,var(--accent)_86%,black)] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-55 disabled:active:translate-y-0 md:min-h-11" type="submit" :disabled="submitting || !canSubmit">
              <svg v-if="submitting" class="h-4 w-4 animate-spin" viewBox="0 0 24 24" aria-hidden="true" fill="none">
                <circle class="opacity-30" cx="12" cy="12" r="9" stroke="currentColor" stroke-width="3"></circle>
                <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" stroke-linecap="round" stroke-width="3"></path>
              </svg>
              <span>{{ closed ? 'Predictions closed' : submitting ? 'Posting...' : 'Post prediction' }}</span>
            </button>
          </div>
        </form>
      </section>
    </div>
  </Transition>
</template>
