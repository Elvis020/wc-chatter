<script setup lang="ts">
import type { Prediction, Room } from '@wc-chatter/shared'

defineProps<{
  open: boolean
  room: Room | null
  prediction: Prediction | null
  submitting: boolean
  canSubmit: boolean
  error: string
}>()

const emit = defineEmits<{
  close: []
  submit: []
}>()

const question = defineModel<string>('question', { required: true })
const answer = defineModel<string>('answer', { required: true })
</script>

<template>
  <Transition name="sheet-flow">
    <div v-if="open && room && prediction" class="sheet-overlay fixed inset-0 z-[1200] grid items-end bg-black/50 p-[env(safe-area-inset-top)_env(safe-area-inset-right)_env(safe-area-inset-bottom)_env(safe-area-inset-left)]" aria-hidden="false" @click.self="submitting ? undefined : emit('close')">
      <section class="sheet-panel mx-auto mb-[max(10px,env(safe-area-inset-bottom))] flex h-fit max-h-[min(86dvh,calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom)-18px))] w-[min(760px,calc(100%-20px))] flex-col overflow-auto rounded-xl border border-[var(--line-strong)] bg-[var(--panel)] p-[18px] shadow-[var(--card-shadow)]" role="dialog" aria-modal="true" :aria-labelledby="`claim-title-${prediction.id}`">
        <div class="sheet-stagger mb-3 flex items-start justify-between gap-3" style="--sheet-index: 0">
          <div class="grid gap-1">
            <h2 class="m-0 text-xl font-extrabold leading-tight max-md:text-[18px]" :id="`claim-title-${prediction.id}`">Claim your prize</h2>
            <p class="m-0 text-[13px] leading-snug text-[var(--muted)]">{{ room.home.code }} {{ prediction.homeScore }}-{{ prediction.awayScore }} {{ room.away.code }} exact pick.</p>
          </div>
          <button class="inline-flex min-h-10 w-10 min-w-10 items-center justify-center rounded-lg border border-[var(--line)] bg-[var(--chip-bg)] p-0 text-[var(--muted)] transition-[background-color,border-color,transform] duration-100 ease-[cubic-bezier(0.4,0,0.2,1)] hover:border-[color:color-mix(in_srgb,var(--line)_82%,black)] hover:bg-[color:color-mix(in_srgb,var(--chip-bg)_88%,black)] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50 disabled:active:translate-y-0" type="button" aria-label="Close" :disabled="submitting" @click="emit('close')">
            <svg class="ph-icon h-5 w-5" viewBox="0 0 256 256" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="18">
              <path d="M200 56 56 200"></path>
              <path d="M56 56l144 144"></path>
            </svg>
          </button>
        </div>

        <form class="sheet-stagger grid gap-2.5" style="--sheet-index: 1" :aria-busy="submitting" @submit.prevent="emit('submit')">
          <div class="grid gap-1.5">
            <label class="text-xs font-bold text-[var(--muted)]" for="claim-question">Question admin should ask</label>
            <input id="claim-question" v-model="question" class="min-h-10 w-full rounded-lg border border-[var(--control-border)] bg-[var(--control-bg)] px-3 text-[var(--text)] outline-none transition-[border-color,box-shadow] duration-150 ease-[var(--ease)] placeholder:text-[color:color-mix(in_srgb,var(--muted)_88%,transparent)] focus:border-[color:color-mix(in_srgb,var(--accent)_46%,var(--control-border))] focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_10%,transparent)] disabled:cursor-wait disabled:opacity-70 md:min-h-11" maxlength="280" placeholder="What should we ask you?" :disabled="submitting" required />
          </div>
          <div class="grid gap-1.5">
            <label class="text-xs font-bold text-[var(--muted)]" for="claim-answer">Answer</label>
            <input id="claim-answer" v-model="answer" class="min-h-10 w-full rounded-lg border border-[var(--control-border)] bg-[var(--control-bg)] px-3 text-[var(--text)] outline-none transition-[border-color,box-shadow] duration-150 ease-[var(--ease)] placeholder:text-[color:color-mix(in_srgb,var(--muted)_88%,transparent)] focus:border-[color:color-mix(in_srgb,var(--accent)_46%,var(--control-border))] focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_10%,transparent)] disabled:cursor-wait disabled:opacity-70 md:min-h-11" maxlength="280" placeholder="Your pickup answer" :disabled="submitting" required />
          </div>
          <p class="m-0 text-xs leading-[1.4] text-[var(--muted)]">Admin will ask this when you come for the prize.</p>
          <p v-if="error" class="m-0 text-xs font-semibold text-[var(--danger)]" role="status" aria-live="polite">{{ error }}</p>
          <button class="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-[var(--accent)] px-[14px] text-[13px] font-extrabold text-[var(--accent-text)] transition-[background-color,transform,opacity] duration-100 ease-[cubic-bezier(0.4,0,0.2,1)] hover:bg-[color:color-mix(in_srgb,var(--accent)_86%,black)] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-55 disabled:active:translate-y-0 md:min-h-11" type="submit" :disabled="submitting || !canSubmit">
            <svg v-if="submitting" class="h-4 w-4 animate-spin" viewBox="0 0 24 24" aria-hidden="true" fill="none">
              <circle class="opacity-30" cx="12" cy="12" r="9" stroke="currentColor" stroke-width="3"></circle>
              <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" stroke-linecap="round" stroke-width="3"></path>
            </svg>
            <span>{{ submitting ? 'Saving...' : 'Save claim' }}</span>
          </button>
        </form>
      </section>
    </div>
  </Transition>
</template>
