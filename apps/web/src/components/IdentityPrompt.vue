<script setup lang="ts">
import { ref } from 'vue'

defineProps<{
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
const input = ref<HTMLInputElement | null>(null)

function focus() {
  input.value?.focus()
}

defineExpose({ focus })
</script>

<template>
  <Transition name="sheet-flow">
    <div v-if="open" class="sheet-overlay fixed inset-0 z-[1300] grid items-end bg-black/50 p-[env(safe-area-inset-top)_env(safe-area-inset-right)_env(safe-area-inset-bottom)_env(safe-area-inset-left)]" aria-hidden="false" @click.self="emit('close')">
      <section class="sheet-panel mx-auto mb-[max(10px,env(safe-area-inset-bottom))] flex max-h-[min(86dvh,calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom)-18px))] w-[min(760px,calc(100%-20px))] flex-col overflow-auto rounded-xl border border-[var(--line-strong)] bg-[var(--panel)] p-[18px] shadow-[var(--card-shadow)]" role="dialog" aria-modal="true" aria-labelledby="identity-title">
        <div class="sheet-stagger mb-4 flex items-center justify-between gap-3" style="--sheet-index: 0">
          <div>
            <h2 id="identity-title" class="m-0 text-xl font-extrabold leading-tight text-[var(--text)]">Pick your room name</h2>
            <p class="m-0 text-[13px] leading-snug text-[var(--muted)]">Set once for this browser. Used for comments and likes.</p>
          </div>
          <button class="inline-flex h-11 min-h-11 w-11 min-w-11 flex-none items-center justify-center rounded-lg bg-white/[0.06] p-0 text-[var(--text)] transition-[background-color,transform] duration-100 ease-[cubic-bezier(0.4,0,0.2,1)] hover:bg-white/[0.1] active:translate-y-px" type="button" aria-label="Set username later" @click="emit('close')">
            <svg class="ph-icon h-5 w-5" viewBox="0 0 256 256" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="18">
              <path d="M200 56 56 200"></path>
              <path d="M56 56l144 144"></path>
            </svg>
          </button>
        </div>

        <form class="sheet-stagger mt-3 grid gap-2.5 rounded-lg border border-[var(--line)] bg-[var(--card-soft)] p-3" style="--sheet-index: 1" @submit.prevent="emit('save')">
          <label class="text-[11px] font-extrabold uppercase text-[var(--muted)]" for="prompt-username">Username</label>
          <div class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
            <input
              id="prompt-username"
              ref="input"
              v-model="usernameDraft"
              class="min-h-11 w-full rounded-lg border border-[var(--control-border)] bg-[var(--control-bg)] px-2.5 text-base font-medium text-[var(--text)] outline-none transition-[border-color,box-shadow] duration-200 ease-[var(--ease)] placeholder:text-[color:color-mix(in_srgb,var(--muted)_88%,transparent)] focus:border-[color:color-mix(in_srgb,var(--accent)_56%,var(--line))] focus:shadow-[0_0_0_4px_color-mix(in_srgb,var(--accent)_10%,transparent)]"
              autocomplete="nickname"
              maxlength="24"
              placeholder="Your name"
              aria-describedby="identity-prompt-help identity-prompt-error"
            />
            <button
              class="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-[color:color-mix(in_srgb,var(--accent)_72%,black)] bg-[var(--accent)] px-3.5 text-[13px] font-[760] leading-none text-[var(--accent-text)] shadow-[0_8px_20px_color-mix(in_srgb,var(--accent)_18%,transparent),inset_0_1px_0_rgba(255,255,255,0.16)] transition-[transform,background-color,border-color,box-shadow,opacity] duration-150 ease-[var(--ease)] hover:border-[color:color-mix(in_srgb,var(--accent)_82%,black)] hover:bg-[color:color-mix(in_srgb,var(--accent)_88%,black)] hover:shadow-[0_10px_24px_color-mix(in_srgb,var(--accent)_22%,transparent),inset_0_1px_0_rgba(255,255,255,0.18)] active:translate-y-px disabled:cursor-not-allowed disabled:border-[var(--line)] disabled:bg-[color:color-mix(in_srgb,var(--control-bg)_70%,var(--panel))] disabled:text-[var(--muted)] disabled:opacity-100 disabled:shadow-none disabled:active:translate-y-0"
              type="submit"
              :disabled="!canSave"
              aria-label="Save username"
            >
              <svg class="h-4 w-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M5.5 5.5h10l3 3v10h-13z"></path>
                <path d="M8 5.5V11h8V5.5"></path>
                <path d="M8 18.5v-4h8v4"></path>
              </svg>
              <span>Save</span>
            </button>
          </div>
          <p id="identity-prompt-help" class="m-0 text-xs leading-[1.4] text-[var(--muted)]">2-24 chars: letters, numbers, space, . ' -</p>
          <p id="identity-prompt-error" class="m-0 min-h-[14px] text-xs leading-[1.4] text-[var(--danger)]" role="status" aria-live="polite">{{ error || message }}</p>
        </form>
      </section>
    </div>
  </Transition>
</template>
