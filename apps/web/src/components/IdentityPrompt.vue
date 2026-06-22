<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps<{
  open: boolean
  canSave: boolean
  error: string
  message: string
}>()

const emit = defineEmits<{
  close: []
  save: []
}>()

const usernameDraft = defineModel<string>('usernameDraft', { required: true })
const prizeQuestionDraft = defineModel<string>('prizeQuestionDraft', { required: true })
const prizeAnswerDraft = defineModel<string>('prizeAnswerDraft', { required: true })
const USERNAME_PATTERN = /^[A-Za-zÀ-ÖØ-öø-ÿ0-9 .'-]{2,24}$/
const input = ref<HTMLInputElement | null>(null)
const prizeQuestionInput = ref<HTMLInputElement | null>(null)
const mobileStep = ref<1 | 2>(1)
const isMobile = ref(false)

const usernameReady = computed(() =>
  USERNAME_PATTERN.test(usernameDraft.value.normalize('NFKC').replace(/\s+/g, ' ').trim()),
)

function syncViewport() {
  isMobile.value = window.matchMedia('(max-width: 767px)').matches
}

function focus() {
  focusCurrentStep()
}

function focusCurrentStep() {
  if (isMobile.value && mobileStep.value === 2) {
    prizeQuestionInput.value?.focus()
    return
  }

  input.value?.focus()
}

function nextStep() {
  if (!usernameReady.value) return
  mobileStep.value = 2
}

function previousStep() {
  mobileStep.value = 1
}

watch(() => props.open, (value) => {
  if (!value) {
    mobileStep.value = 1
    return
  }

  if (!isMobile.value) return
  mobileStep.value = usernameReady.value ? 2 : 1
})

watch(mobileStep, () => {
  if (!props.open) return
  requestAnimationFrame(() => focusCurrentStep())
})

onMounted(() => {
  syncViewport()
  window.addEventListener('resize', syncViewport)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', syncViewport)
})

defineExpose({ focus })
</script>

<template>
  <Transition name="sheet-flow">
    <div v-if="props.open" class="sheet-overlay fixed inset-0 z-[1300] grid items-end bg-black/50 p-[env(safe-area-inset-top)_env(safe-area-inset-right)_env(safe-area-inset-bottom)_env(safe-area-inset-left)]" aria-hidden="false" @click.self="emit('close')">
      <section class="sheet-panel mx-auto mb-[max(10px,env(safe-area-inset-bottom))] flex max-h-[min(86dvh,calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom)-18px))] w-[min(920px,calc(100%-20px))] flex-col overflow-auto rounded-xl border border-[var(--line-strong)] bg-[var(--panel)] p-4 shadow-[var(--card-shadow)]" role="dialog" aria-modal="true" aria-labelledby="identity-title">
        <div class="sheet-stagger mb-3 flex items-center justify-between gap-3" style="--sheet-index: 0">
          <div>
            <h2 id="identity-title" class="m-0 text-lg font-extrabold leading-tight text-[var(--text)]">Pick your room name</h2>
            <p class="m-0 text-xs leading-snug text-[var(--muted)]">Used for comments, likes, and prize pickup.</p>
          </div>
          <button class="inline-flex h-11 min-h-11 w-11 min-w-11 flex-none items-center justify-center rounded-lg bg-white/[0.06] p-0 text-[var(--text)] transition-[background-color,transform] duration-100 ease-[cubic-bezier(0.4,0,0.2,1)] hover:bg-white/[0.1] active:translate-y-px" type="button" aria-label="Set username later" @click="emit('close')">
            <svg class="ph-icon h-5 w-5" viewBox="0 0 256 256" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="18">
              <path d="M200 56 56 200"></path>
              <path d="M56 56l144 144"></path>
            </svg>
          </button>
        </div>

        <form class="sheet-stagger mt-2 grid gap-3 rounded-lg border border-[var(--line)] bg-[var(--card-soft)] p-3" style="--sheet-index: 1" @submit.prevent="emit('save')">
          <p class="m-0 rounded-md border border-[var(--line)] bg-[color:color-mix(in_srgb,var(--panel)_34%,transparent)] px-3 py-2 text-xs leading-[1.35] text-[var(--soft)]">
            Some predictions have prizes, so this helps confirm winners at pickup.
          </p>

          <div v-if="isMobile" class="grid gap-3">
            <div class="grid grid-cols-2 gap-2 rounded-lg border border-[var(--line)] bg-[color:color-mix(in_srgb,var(--panel)_42%,transparent)] p-1.5">
              <div class="rounded-md px-3 py-2 text-center text-[11px] font-extrabold uppercase tracking-[0.08em]" :class="mobileStep === 1 ? 'bg-[var(--accent)] text-[var(--accent-text)]' : 'text-[var(--muted)]'">Room name</div>
              <div class="rounded-md px-3 py-2 text-center text-[11px] font-extrabold uppercase tracking-[0.08em]" :class="mobileStep === 2 ? 'bg-[var(--accent)] text-[var(--accent-text)]' : 'text-[var(--muted)]'">Pickup check</div>
            </div>

            <div v-if="mobileStep === 1" class="grid gap-2">
              <div class="flex items-baseline justify-between gap-3">
                <label class="text-[11px] font-extrabold uppercase text-[var(--muted)]" for="prompt-username">Username</label>
                <span class="text-[11px] font-semibold text-[var(--muted)]">Shown in room</span>
              </div>
              <input
                id="prompt-username"
                ref="input"
                v-model="usernameDraft"
                class="min-h-11 w-full rounded-lg border border-[var(--control-border)] bg-[var(--control-bg)] px-3 text-base font-medium text-[var(--text)] outline-none transition-[border-color,box-shadow] duration-200 ease-[var(--ease)] placeholder:text-[color:color-mix(in_srgb,var(--muted)_88%,transparent)] focus:border-[color:color-mix(in_srgb,var(--accent)_56%,var(--line))] focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_10%,transparent)]"
                autocomplete="nickname"
                maxlength="24"
                placeholder="Your name"
                aria-describedby="identity-prompt-help identity-prompt-error"
              />
              <p id="identity-prompt-help" class="m-0 text-xs leading-[1.4] text-[var(--muted)]">2-24 chars: letters, numbers, space, . ' -</p>
            </div>

            <div v-else class="grid gap-3">
              <div class="grid gap-2">
                <label class="text-[11px] font-extrabold uppercase text-[var(--muted)]" for="prompt-prize-question">Pickup question</label>
                <input
                  id="prompt-prize-question"
                  ref="prizeQuestionInput"
                  v-model="prizeQuestionDraft"
                  class="min-h-11 w-full rounded-lg border border-[var(--control-border)] bg-[var(--control-bg)] px-3 text-base font-medium text-[var(--text)] outline-none transition-[border-color,box-shadow] duration-200 ease-[var(--ease)] placeholder:text-[color:color-mix(in_srgb,var(--muted)_88%,transparent)] focus:border-[color:color-mix(in_srgb,var(--accent)_56%,var(--line))] focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_10%,transparent)]"
                  maxlength="280"
                  placeholder="Example: Last three digits?"
                  aria-describedby="pickup-question-help identity-prompt-error"
                />
                <p id="pickup-question-help" class="m-0 text-xs leading-[1.4] text-[var(--muted)]">What admin asks before pickup.</p>
              </div>

              <div class="grid gap-2">
                <label class="text-[11px] font-extrabold uppercase text-[var(--muted)]" for="prompt-prize-answer">Pickup answer</label>
                <input
                  id="prompt-prize-answer"
                  v-model="prizeAnswerDraft"
                  class="min-h-11 w-full rounded-lg border border-[var(--control-border)] bg-[var(--control-bg)] px-3 text-base font-medium text-[var(--text)] outline-none transition-[border-color,box-shadow] duration-200 ease-[var(--ease)] placeholder:text-[color:color-mix(in_srgb,var(--muted)_88%,transparent)] focus:border-[color:color-mix(in_srgb,var(--accent)_56%,var(--line))] focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_10%,transparent)]"
                  maxlength="280"
                  placeholder="Example: 184"
                  aria-describedby="pickup-answer-help identity-prompt-error"
                />
                <p id="pickup-answer-help" class="m-0 text-xs leading-[1.4] text-[var(--muted)]">Stored for pickup only.</p>
              </div>
            </div>
          </div>

          <div v-else class="grid gap-3 min-[760px]:grid-cols-[minmax(190px,0.82fr)_minmax(260px,1.28fr)_minmax(180px,0.9fr)] min-[760px]:items-start">
            <div class="grid gap-2">
              <div class="flex items-baseline justify-between gap-3">
                <label class="text-[10px] font-extrabold uppercase text-[var(--muted)]" for="prompt-username">Username</label>
                <span class="text-[10px] font-semibold text-[var(--muted)]">Shown in room</span>
              </div>
              <input
                id="prompt-username"
                ref="input"
                v-model="usernameDraft"
                class="min-h-10 w-full rounded-lg border border-[var(--control-border)] bg-[var(--control-bg)] px-2.5 text-sm font-medium text-[var(--text)] outline-none transition-[border-color,box-shadow] duration-200 ease-[var(--ease)] placeholder:text-[color:color-mix(in_srgb,var(--muted)_88%,transparent)] focus:border-[color:color-mix(in_srgb,var(--accent)_56%,var(--line))] focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_10%,transparent)]"
                autocomplete="nickname"
                maxlength="24"
                placeholder="Your name"
                aria-describedby="identity-prompt-help identity-prompt-error"
              />
              <p id="identity-prompt-help" class="m-0 text-[11px] leading-[1.3] text-[var(--muted)]">2-24 chars: letters, numbers, space, . ' -</p>
            </div>

            <div class="grid gap-2">
              <label class="text-[10px] font-extrabold uppercase text-[var(--muted)]" for="prompt-prize-question">Pickup question</label>
              <input
                id="prompt-prize-question"
                ref="prizeQuestionInput"
                v-model="prizeQuestionDraft"
                class="min-h-10 w-full rounded-lg border border-[var(--control-border)] bg-[var(--control-bg)] px-2.5 text-sm font-medium text-[var(--text)] outline-none transition-[border-color,box-shadow] duration-200 ease-[var(--ease)] placeholder:text-[color:color-mix(in_srgb,var(--muted)_88%,transparent)] focus:border-[color:color-mix(in_srgb,var(--accent)_56%,var(--line))] focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_10%,transparent)]"
                maxlength="280"
                placeholder="Example: Last three digits?"
                aria-describedby="pickup-question-help identity-prompt-error"
              />
              <p id="pickup-question-help" class="m-0 text-[11px] leading-[1.3] text-[var(--muted)]">What admin asks before pickup.</p>
            </div>

            <div class="grid gap-2">
              <label class="text-[10px] font-extrabold uppercase text-[var(--muted)]" for="prompt-prize-answer">Pickup answer</label>
              <input
                id="prompt-prize-answer"
                v-model="prizeAnswerDraft"
                class="min-h-10 w-full rounded-lg border border-[var(--control-border)] bg-[var(--control-bg)] px-2.5 text-sm font-medium text-[var(--text)] outline-none transition-[border-color,box-shadow] duration-200 ease-[var(--ease)] placeholder:text-[color:color-mix(in_srgb,var(--muted)_88%,transparent)] focus:border-[color:color-mix(in_srgb,var(--accent)_56%,var(--line))] focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_10%,transparent)]"
                maxlength="280"
                placeholder="Example: 184"
                aria-describedby="pickup-answer-help identity-prompt-error"
              />
              <p id="pickup-answer-help" class="m-0 text-[11px] leading-[1.3] text-[var(--muted)]">Stored for pickup only.</p>
            </div>
          </div>

          <div class="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--line)] pt-2.5">
            <p id="identity-prompt-error" class="m-0 min-h-[14px] min-w-[220px] flex-1 text-xs leading-[1.35] text-[var(--danger)]" role="status" aria-live="polite">{{ props.error || props.message }}</p>
            <div class="flex w-full flex-col-reverse gap-2 sm:w-auto sm:flex-row sm:items-center">
              <button
                v-if="isMobile && mobileStep === 2"
                class="inline-flex min-h-10 items-center justify-center rounded-lg border border-[var(--line)] bg-transparent px-3.5 text-xs font-[760] leading-none text-[var(--muted)] transition-[background-color,color,transform] duration-150 ease-[var(--ease)] hover:bg-[color:color-mix(in_srgb,var(--panel)_58%,transparent)] hover:text-[var(--text)] active:translate-y-px max-sm:w-full"
                type="button"
                @click="previousStep"
              >Back</button>
              <button
                v-if="isMobile && mobileStep === 1"
                class="inline-flex min-h-10 min-w-[118px] items-center justify-center gap-2 rounded-lg border border-[color:color-mix(in_srgb,var(--accent)_40%,var(--line))] bg-[color:color-mix(in_srgb,var(--accent)_8%,var(--panel))] px-3.5 text-xs font-[760] leading-none text-[var(--accent)] transition-[transform,background-color,border-color,box-shadow,opacity] duration-150 ease-[var(--ease)] hover:border-[color:color-mix(in_srgb,var(--accent)_54%,var(--line))] hover:bg-[color:color-mix(in_srgb,var(--accent)_12%,var(--panel))] active:translate-y-px disabled:cursor-not-allowed disabled:border-[var(--line)] disabled:bg-[color:color-mix(in_srgb,var(--control-bg)_70%,var(--panel))] disabled:text-[var(--muted)] disabled:opacity-100 disabled:shadow-none disabled:active:translate-y-0 max-sm:w-full"
                type="button"
                :disabled="!usernameReady"
                @click="nextStep"
              >Continue</button>
              <button
                v-else
                class="inline-flex min-h-10 min-w-[118px] items-center justify-center gap-2 rounded-lg border border-[color:color-mix(in_srgb,var(--accent)_72%,black)] bg-[var(--accent)] px-3.5 text-xs font-[760] leading-none text-[var(--accent-text)] shadow-[0_6px_16px_color-mix(in_srgb,var(--accent)_16%,transparent),inset_0_1px_0_rgba(255,255,255,0.16)] transition-[transform,background-color,border-color,box-shadow,opacity] duration-150 ease-[var(--ease)] hover:border-[color:color-mix(in_srgb,var(--accent)_82%,black)] hover:bg-[color:color-mix(in_srgb,var(--accent)_88%,black)] hover:shadow-[0_8px_18px_color-mix(in_srgb,var(--accent)_18%,transparent),inset_0_1px_0_rgba(255,255,255,0.18)] active:translate-y-px disabled:cursor-not-allowed disabled:border-[var(--line)] disabled:bg-[color:color-mix(in_srgb,var(--control-bg)_70%,var(--panel))] disabled:text-[var(--muted)] disabled:opacity-100 disabled:shadow-none disabled:active:translate-y-0 max-sm:w-full"
                type="submit"
                :disabled="!props.canSave"
                aria-label="Save room name and pickup check"
              >
                <svg class="h-4 w-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M5.5 5.5h10l3 3v10h-13z"></path>
                  <path d="M8 5.5V11h8V5.5"></path>
                  <path d="M8 18.5v-4h8v4"></path>
                </svg>
                <span>Save setup</span>
              </button>
            </div>
          </div>
        </form>
      </section>
    </div>
  </Transition>
</template>
