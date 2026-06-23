<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { DEFAULT_MATCH_CYCLE_START_HOUR_UTC, compareRoomsForSwitcher as compareRoomsForSwitcherByState, effectiveRoomMatchStatus as effectiveRoomMatchStatusByState, isRoomLocked as isRoomLockedByState, loadFixtures, matchKickoffUtc, mockThemes, roomKickoffMs as roomKickoffMsByState, roomKickoffTime as roomKickoffTimeByState, subdivisionFlagIso2, type ApiEvent, type Comment as PredictionComment, type CreatePredictionInput, type Prediction, type PredictionCommentInput, type PrizeDeskEntry, type Reply, type ReplyInput, type Room, type Team, type ThemeId, type TypingEvent, type TypingTarget } from '@turntabl-score-room/shared'
import 'flag-icons/css/flag-icons.min.css'
import { connectRoomEvents, createPrediction, createPredictionComment, createReply, fetchBootstrap, fetchPrizeDeskEntries, fetchRoom, togglePredictionLike, updateReply } from './lib/api'
import IdentityPrompt from './components/IdentityPrompt.vue'
import ScoreDrawer from './components/ScoreDrawer.vue'
import { createNaviiIcon } from './lib/navii'
import {
  getOrCreateUserId,
  getStoredActiveRoomId,
  getStoredLikes,
  getStoredPrizeAnswer,
  getStoredPrizeQuestion,
  getStoredPredictionDrafts,
  getStoredReplyDrafts,
  getStoredTheme,
  getStoredUsername,
  setStoredActiveRoomId,
  setStoredUsername,
  setStoredLikes,
  setStoredPrizeAnswer,
  setStoredPrizeQuestion,
  setStoredPredictionDrafts,
  setStoredReplyDrafts,
  setStoredTheme,
} from './lib/storage'

const USERNAME_PATTERN = /^[A-Za-zÀ-ÖØ-öø-ÿ0-9 .'-]{2,24}$/
const MIN_PREDICTION_COMMENT_LENGTH = 4
const COMMENT_PREVIEW_LIMIT = 3
const ACTIVE_ROOM_POLL_MS = 3_500
const ROOM_REFRESH_MS = 60_000
const ADMIN_PRIZE_PAGE_SIZE = 6
const TYPING_IDLE_MS = 1800
const TYPING_THROTTLE_MS = 1400
const TYPING_VISIBLE_MS = 3200
const TOP_PICK_SLIDE_MS = 4400
const ADMIN_ROUTE = '/turntabl-prize-desk'
const fixtureKickoffs = new Map(
  loadFixtures().flatMap((match) => {
    const kickoff = matchKickoffUtc(match)
    return [
      [match.id, kickoff],
      [`${match.home.code}-${match.away.code}`, kickoff],
    ]
  }),
)
type FeedSortMode = 'likes' | 'comments'
type AdminPrizeFilter = 'all' | 'winner' | 'pending' | 'verified' | 'missing'
type RealtimeStatus = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'offline'
type PendingIdentityAction =
  | { type: 'like'; predictionId: string; authorId?: string }
  | { type: 'reply'; predictionId: string; targetId: string }
  | { type: 'prediction' }
type FaviconTheme = {
  accent: string
  panel: string
  text: string
}
type TypingState = {
  userId: string
  name: string
  target: TypingTarget
  targetId: string
  expiresAt: number
}
type RoomDayBucket = {
  key: string
  label: string
  startMs: number
  rooms: Room[]
}
type TopPickInsight = {
  key: string
  icon: string
  label: string
  value: string
  detail: string
  caption: string
  tone: 'hot' | 'calm' | 'split' | 'sharp' | 'empty' | 'winner'
  crowd?: {
    pickCount: number
    total: number
    share: number
    predictorLabel: string
  }
  weather?: {
    picks: number
    comments: number
    likes: number
  }
  split?: {
    home: number
    draw: number
    away: number
    homeLabel: string
    awayLabel: string
  }
  winners?: {
    count: number
    names: string[]
    score: string
  }
}

const faviconThemes: Record<ThemeId, FaviconTheme> = {
  paper: { accent: '#b45309', panel: '#fff9ec', text: '#2a2520' },
  desk: { accent: '#315c4c', panel: '#ffffff', text: '#20231f' },
  pub: { accent: '#d6a43a', panel: '#23211d', text: '#1c1c1c' },
  press: { accent: '#9a3412', panel: '#fbfaf4', text: '#1c1917' },
}

const userId = getOrCreateUserId()
const showUsernameReset = import.meta.env.VITE_ENABLE_USERNAME_RESET !== 'false'
const username = ref(getStoredUsername())
const usernameDraft = ref(username.value)
const prizeQuestion = ref(getStoredPrizeQuestion())
const prizeQuestionDraft = ref(prizeQuestion.value)
const prizeAnswer = ref(getStoredPrizeAnswer())
const prizeAnswerDraft = ref(prizeAnswer.value)
const usernameError = ref('')
const rooms = ref<Room[]>([])
const adminEntries = ref<PrizeDeskEntry[]>([])
const adminPrizeFilter = ref<AdminPrizeFilter>('all')
const adminPrizePage = ref(0)
const selectedAdminEntryId = ref('')
const activeRoomId = ref(getStoredActiveRoomId())
const loading = ref(true)
const refreshingRooms = ref(false)
const adminLoading = ref(false)
const adminError = ref('')
const errorMessage = ref('')
const mutationError = ref('')
const realtimeStatus = ref<RealtimeStatus>('idle')
const routePath = ref(window.location.pathname)
const predictionModalOpen = ref(false)
const submittingPrediction = ref(false)
const identityPromptOpen = ref(false)
const identityPromptMessage = ref('')
const isMobileViewportState = ref(window.matchMedia('(max-width: 767px)').matches)
const themeMenuOpen = ref(false)
const selectedTheme = ref<ThemeId>(getStoredTheme() as ThemeId)
const themePreview = ref<ThemeId | null>(null)
const highlightedThemeIndex = ref(0)
const feedSortMode = ref<FeedSortMode>('likes')
const selectedRoomBucketKey = ref('')
const likedPredictions = ref(getStoredLikes())
const activeReplyTarget = ref<{ predictionId: string; targetId: string } | null>(null)
const closingReplyTargets = ref(new Set<string>())
const expandedCommentCards = ref(new Set<string>())
const fastCollapsingCommentCards = ref(new Set<string>())
const pendingIdentityAction = ref<PendingIdentityAction | null>(null)
const activeTopPickIndex = ref(0)
const themeTrigger = ref<HTMLElement | null>(null)
const identityPrompt = ref<InstanceType<typeof IdentityPrompt> | null>(null)
const scoreDrawer = ref<InstanceType<typeof ScoreDrawer> | null>(null)
const predictionFeed = ref<HTMLElement | null>(null)
const predictionFeedList = ref<HTMLElement | null>(null)
const themeMenuStyle = ref<Record<string, string>>({})
const themeOptionRefs = ref<HTMLButtonElement[]>([])
const ws = ref<WebSocket | null>(null)
const submittingReplies = ref(new Set<string>())
const submittingEdits = ref(new Set<string>())
const editingReplyId = ref('')
const replyErrors = reactive<Record<string, string>>({})
const editDrafts = reactive<Record<string, string>>({})
const editErrors = reactive<Record<string, string>>({})
const updatedRoomIds = ref(new Set<string>())
const updatedPredictionIds = ref(new Set<string>())
const typingPeople = ref(new Map<string, TypingState>())
const feedNavMode = ref<'hidden' | 'up' | 'down'>('hidden')
const roomSwitchDirection = ref<'forward' | 'backward'>('forward')
let identityPromptTimer: ReturnType<typeof window.setTimeout> | null = null
let mutationErrorTimer: ReturnType<typeof window.setTimeout> | null = null
let reconnectTimer: ReturnType<typeof window.setTimeout> | null = null
let activeRoomPollTimer: ReturnType<typeof window.setInterval> | null = null
let roomRefreshTimer: ReturnType<typeof window.setInterval> | null = null
let topPickCarouselTimer: ReturnType<typeof window.setInterval> | null = null
let themePreviewTimer: ReturnType<typeof window.setTimeout> | null = null
let themeTransitionTimer: ReturnType<typeof window.setTimeout> | null = null
let fastCommentCollapseTimer: ReturnType<typeof window.setTimeout> | null = null
let replyFocusTimers: ReturnType<typeof window.setTimeout>[] = []
let livePulseTimer: ReturnType<typeof window.setTimeout> | null = null
let typingCleanupTimer: ReturnType<typeof window.setTimeout> | null = null
let lastFocusedElement: HTMLElement | null = null
let reconnectAttempt = 0
let socketToken = 0
let roomsRefreshInFlight = false
let activeRoomRefreshInFlight = false
const avatarCache = new Map<string, string>()
const typingStopTimers = new Map<string, ReturnType<typeof window.setTimeout>>()
const lastTypingSentAt = new Map<string, number>()

const predictionForm = reactive({
  homeScore: 2,
  awayScore: 1,
  comment: '',
})

const predictionDrafts = reactive<Record<string, string>>(getStoredPredictionDrafts())
const replyDrafts = reactive<Record<string, string>>(getStoredReplyDrafts())

const activeRoom = computed(() => rooms.value.find((room) => room.id === activeRoomId.value) ?? rooms.value.find((room) => room.isFeatured) ?? rooms.value[0] ?? null)
const sortedPredictions = computed(() => {
  const score = (prediction: Prediction) =>
    feedSortMode.value === 'likes' ? prediction.likes : predictionCommentTotal(prediction)

  return [...(activeRoom.value?.predictions ?? [])].sort((left, right) => {
    const scoreDelta = score(right) - score(left)
    if (scoreDelta !== 0) return scoreDelta
    return right.likes - left.likes || predictionCommentTotal(right) - predictionCommentTotal(left)
  })
})
const feedSortLabel = computed(() =>
  feedSortMode.value === 'likes' ? 'Top liked' : 'Most discussed',
)
const mobileFeedSortLabel = computed(() => 'Sort')
const nextFeedSortLabel = computed(() =>
  feedSortMode.value === 'likes' ? 'Sort by most discussed' : 'Sort by top liked',
)
const totalLikes = computed(() => activeRoom.value?.predictions.reduce((sum, item) => sum + item.likes, 0) ?? 0)
const totalComments = computed(
  () =>
    activeRoom.value?.predictions.reduce(
      (sum, item) =>
        sum +
        item.comments.reduce((commentSum, comment) => commentSum + 1 + comment.replies.length, 0),
      0,
    ) ?? 0,
)
const activeRoomFinalScore = computed(() => finalScoreForRoom(activeRoom.value))
const exactPickPredictions = computed(() => {
  const score = activeRoomFinalScore.value
  if (!score || !activeRoom.value) return []
  return activeRoom.value.predictions.filter((prediction) => isExactPick(prediction, score))
})
const exactPickNames = computed(() => exactPickPredictions.value.map((prediction) => prediction.name))
const exactPickPreview = computed(() => {
  const names = exactPickNames.value.slice(0, 3)
  const remaining = exactPickNames.value.length - names.length
  if (!names.length) return ''
  return `${names.join(' · ')}${remaining > 0 ? ` · +${remaining} more` : ''}`
})
const topPickInsights = computed<TopPickInsight[]>(() => buildTopPickInsights(activeRoom.value))
const activeTopPickInsight = computed(() => topPickInsights.value[activeTopPickIndex.value % Math.max(1, topPickInsights.value.length)] ?? null)
const hasPrizeVerification = computed(() => prizeQuestion.value.trim().length >= 4 && prizeAnswer.value.trim().length >= 2)
const hasIdentitySetup = computed(() => !!username.value && hasPrizeVerification.value)
const usernameConflictRoom = computed(() => {
  const result = validateUsername(usernameDraft.value)
  return result.ok ? findRoomUsernameConflict(result.value) : null
})
const usernameConflictMessage = computed(() => {
  const room = usernameConflictRoom.value
  if (!room) return ''
  const result = validateUsername(usernameDraft.value)
  if (!result.ok) return ''
  return `${result.value} is already in use in ${roomLabel(room)}. Pick another name for this room.`
})
const canSaveUsername = computed(() =>
  usernameDraft.value.trim().length > 0 &&
  prizeQuestionDraft.value.trim().length >= 4 &&
  prizeAnswerDraft.value.trim().length >= 2 &&
  !usernameConflictRoom.value &&
  (!username.value || !hasPrizeVerification.value),
)
const canSortPredictions = computed(() => (activeRoom.value?.predictions.length ?? 0) > 0)
const activeRoomPredictionsClosed = computed(() => !!activeRoom.value && isRoomLockedByState(activeRoom.value, { fixtureKickoffs }))
const canSubmitPrediction = computed(() => !activeRoomPredictionsClosed.value)
const userPrediction = computed(() => activeRoom.value?.predictions.find((prediction) => prediction.authorId === userId) ?? null)
const hasUserPredicted = computed(() => !!userPrediction.value)
const scoreCtaLabel = computed(() => {
  if (activeRoomPredictionsClosed.value) return 'Predictions closed'
  return hasUserPredicted.value ? 'Already predicted' : 'Drop your score'
})
const scoreCtaDisabled = computed(() => hasUserPredicted.value || activeRoomPredictionsClosed.value)
const isAdminRoute = computed(() => routePath.value === ADMIN_ROUTE)
const isNotFound = computed(() => routePath.value !== '/' && !isAdminRoute.value)
const showMobileAdminMessage = computed(() => isAdminRoute.value && isMobileViewportState.value)
const bannerNoticeText = computed(() =>
  isMobileViewportState.value
    ? 'Use this device to keep your room name and claim prizes.'
    : 'Your room name stays on this browser. Use the same device when claiming prizes.',
)
const shouldAutoPromptUsername = computed(() =>
  !isNotFound.value &&
  !isAdminRoute.value &&
  !errorMessage.value &&
  rooms.value.length > 0 &&
  !isMobileViewportState.value,
)
const orderedRooms = computed(() =>
  [...rooms.value].sort((left, right) => compareRoomsForSwitcherByState(left, right, { fixtureKickoffs })),
)
const currentRoomCycleKey = computed(() => roomCycleDateKey(Date.now()))
const roomDayBuckets = computed<RoomDayBucket[]>(() => {
  const buckets = new Map<string, Room[]>()

  for (const room of orderedRooms.value) {
    const key = roomCycleDateKey(roomKickoffMs(room))
    buckets.set(key, [...(buckets.get(key) ?? []), room])
  }

  return [...buckets.entries()]
    .map(([key, bucketRooms]) => ({
      key,
      label: roomBucketLabel(key, currentRoomCycleKey.value),
      startMs: roomCycleStartMs(key),
      rooms: bucketRooms,
    }))
    .sort((left, right) => right.startMs - left.startMs)
})
const selectedRoomBucketIndex = computed(() =>
  roomDayBuckets.value.findIndex((bucket) => bucket.key === selectedRoomBucketKey.value),
)
const currentRoomBucket = computed(() => {
  const index = selectedRoomBucketIndex.value
  return index >= 0 ? roomDayBuckets.value[index] : roomDayBuckets.value[0] ?? null
})
const leftRoomBucket = computed(() => {
  const index = selectedRoomBucketIndex.value
  return index > 0 ? roomDayBuckets.value[index - 1] : null
})
const rightRoomBucket = computed(() => {
  const index = selectedRoomBucketIndex.value
  return index >= 0 && index < roomDayBuckets.value.length - 1 ? roomDayBuckets.value[index + 1] : null
})
const visibleRooms = computed(() => {
  return currentRoomBucket.value?.rooms ?? []
})
const roomPageCount = computed(() => Math.max(1, roomDayBuckets.value.length))
const roomPageLabel = computed(() => `${Math.max(1, selectedRoomBucketIndex.value + 1)}/${roomPageCount.value}`)
const statusNotice = computed(() => {
  if (mutationError.value) return mutationError.value
  if (refreshingRooms.value) return 'Refreshing rooms...'
  if (realtimeStatus.value === 'connecting') return 'Connecting to live room...'
  if (realtimeStatus.value === 'reconnecting') return 'Live updates paused. Reconnecting...'
  if (realtimeStatus.value === 'offline') return 'Live updates are offline. Retrying...'
  return ''
})
const adminWinnerCount = computed(() => adminEntries.value.filter((entry) => entry.result === 'winner').length)
const adminVerifiedCount = computed(() => adminEntries.value.filter((entry) => entry.pickup).length)
const adminPendingCount = computed(() => adminEntries.value.filter((entry) => entry.result === 'pending').length)
const adminMissingPickupCount = computed(() => adminEntries.value.filter((entry) => !entry.pickup).length)
const adminFilteredEntries = computed(() => {
  if (adminPrizeFilter.value === 'winner') return adminEntries.value.filter((entry) => entry.result === 'winner')
  if (adminPrizeFilter.value === 'pending') return adminEntries.value.filter((entry) => entry.result === 'pending')
  if (adminPrizeFilter.value === 'verified') return adminEntries.value.filter((entry) => entry.pickup)
  if (adminPrizeFilter.value === 'missing') return adminEntries.value.filter((entry) => !entry.pickup)
  return adminEntries.value
})
const adminPrizePageCount = computed(() => Math.max(1, Math.ceil(adminFilteredEntries.value.length / ADMIN_PRIZE_PAGE_SIZE)))
const adminPrizeVisibleEntries = computed(() => {
  const start = adminPrizePage.value * ADMIN_PRIZE_PAGE_SIZE
  return adminFilteredEntries.value.slice(start, start + ADMIN_PRIZE_PAGE_SIZE)
})
const adminPrizeRangeLabel = computed(() => {
  if (!adminFilteredEntries.value.length) return '0 of 0'
  const start = adminPrizePage.value * ADMIN_PRIZE_PAGE_SIZE + 1
  const end = Math.min(adminFilteredEntries.value.length, start + ADMIN_PRIZE_PAGE_SIZE - 1)
  return `${start}-${end} of ${adminFilteredEntries.value.length}`
})
const selectedAdminEntry = computed(() =>
  adminEntries.value.find((entry) => entry.id === selectedAdminEntryId.value) ?? null,
)
const effectiveTheme = computed(() => themePreview.value ?? selectedTheme.value)

watch(effectiveTheme, (value) => {
  document.body.classList.add('theme-transitioning')
  if (themeTransitionTimer) {
    window.clearTimeout(themeTransitionTimer)
  }
  document.body.dataset.theme = value === 'paper' ? '' : value
  updateFavicon(value)
  themeTransitionTimer = window.setTimeout(() => {
    document.body.classList.remove('theme-transitioning')
    themeTransitionTimer = null
  }, 260)
}, { immediate: true })

watch(selectedTheme, (value) => {
  setStoredTheme(value)
})

watch(activeRoom, (room, previousRoom) => {
  if (!room) return
  if (room.id !== previousRoom?.id) {
    activeTopPickIndex.value = 0
  }
  predictionForm.homeScore = room.mostBacked.home
  predictionForm.awayScore = room.mostBacked.away
  predictionForm.comment = predictionDrafts[room.id] ?? ''
})

watch(() => topPickInsights.value.length, (slideCount) => {
  if (slideCount <= 1) {
    activeTopPickIndex.value = 0
    return
  }
  if (activeTopPickIndex.value >= slideCount) {
    activeTopPickIndex.value %= slideCount
  }
})

watch(activeRoomId, (roomId) => {
  if (roomId) setStoredActiveRoomId(roomId)
  connectActiveRoomEvents(roomId)
})

watch(adminPrizeFilter, () => {
  adminPrizePage.value = 0
})

watch(adminPrizePageCount, (pageCount) => {
  if (adminPrizePage.value >= pageCount) {
    adminPrizePage.value = pageCount - 1
  }
})

watch(roomDayBuckets, (buckets) => {
  if (!buckets.length) {
    selectedRoomBucketKey.value = ''
    return
  }

  if (buckets.some((bucket) => bucket.key === selectedRoomBucketKey.value)) return

  selectedRoomBucketKey.value =
    buckets.find((bucket) => bucket.key === currentRoomCycleKey.value)?.key ??
    buckets.find((bucket) => bucket.startMs > roomCycleStartMs(currentRoomCycleKey.value))?.key ??
    buckets[0].key
}, { immediate: true })

watch(username, (value) => {
  if (value) usernameDraft.value = value
})

watch(usernameDraft, (value) => {
  const limited = value.slice(0, 24)
  if (value !== limited) usernameDraft.value = limited
}, { flush: 'sync' })

watch(() => predictionForm.comment, (comment) => {
  const roomId = activeRoom.value?.id
  if (!roomId) return
  predictionDrafts[roomId] = comment
  setStoredPredictionDrafts({ ...predictionDrafts })
})

watch(replyDrafts, () => {
  setStoredReplyDrafts({ ...replyDrafts })
}, { deep: true })

watch([sortedPredictions, activeRoomId], () => {
  nextTick(updateFeedNavMode)
})

watch(themeMenuOpen, (open) => {
  if (!open) return
  highlightedThemeIndex.value = Math.max(0, mockThemes.findIndex((theme) => theme.id === selectedTheme.value))
  nextTick(() => {
    positionThemeMenu()
    focusThemeOption(highlightedThemeIndex.value)
  })
})

watch([identityPromptOpen, predictionModalOpen, selectedAdminEntry], ([identityOpen, predictionOpen, adminEntry]) => {
  if (identityOpen || predictionOpen || adminEntry) {
    if (!lastFocusedElement) {
      lastFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null
    }
    nextTick(() => {
      focusActiveOverlay()
    })
    return
  }

  if (lastFocusedElement) {
    lastFocusedElement.focus({ preventScroll: true })
    lastFocusedElement = null
  }
})

function validateUsername(value: string) {
  const normalized = value.normalize('NFKC').replace(/\s+/g, ' ').trim().slice(0, 24)
  if (!USERNAME_PATTERN.test(normalized)) {
    return {
      ok: false,
      value: normalized,
      message: 'Use 2-24 chars',
    }
  }

  return { ok: true, value: normalized, message: '' }
}

function usernameKey(value: string) {
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase()
}

function roomLabel(room: Room) {
  return `${room.home.code} vs ${room.away.code}`
}

function findRoomUsernameConflict(name: string) {
  const room = activeRoom.value
  if (!room) return null

  const target = usernameKey(name)
  if (!target) return null

  for (const prediction of room.predictions) {
    if (prediction.authorId && prediction.authorId !== userId && usernameKey(prediction.name) === target) {
      return room
    }

    for (const comment of prediction.comments) {
      if (comment.authorId && comment.authorId !== userId && usernameKey(comment.name) === target) {
        return room
      }

      for (const reply of comment.replies) {
        if (reply.authorId !== userId && usernameKey(reply.name) === target) {
          return room
        }
      }
    }
  }

  return null
}

function saveUsername() {
  const result = validateUsername(usernameDraft.value)
  if (!result.ok) {
    usernameError.value = result.message
    return
  }

  const conflictRoom = findRoomUsernameConflict(result.value)
  if (conflictRoom) {
    usernameError.value = `${result.value} is already in use in ${roomLabel(conflictRoom)}. Pick another name for this room.`
    return
  }

  const normalizedPrizeQuestion = prizeQuestionDraft.value.normalize('NFKC').replace(/\s+/g, ' ').trim()
  const normalizedPrizeAnswer = prizeAnswerDraft.value.normalize('NFKC').replace(/\s+/g, ' ').trim()
  if (normalizedPrizeQuestion.length < 4) {
    usernameError.value = 'Pickup question must be at least 4 characters.'
    return
  }
  if (normalizedPrizeAnswer.length < 2) {
    usernameError.value = 'Pickup answer must be at least 2 characters.'
    return
  }

  username.value = result.value
  usernameDraft.value = result.value
  prizeQuestion.value = normalizedPrizeQuestion
  prizeQuestionDraft.value = normalizedPrizeQuestion
  prizeAnswer.value = normalizedPrizeAnswer
  prizeAnswerDraft.value = normalizedPrizeAnswer
  usernameError.value = ''
  setStoredUsername(result.value)
  setStoredPrizeQuestion(normalizedPrizeQuestion)
  setStoredPrizeAnswer(normalizedPrizeAnswer)
  const action = pendingIdentityAction.value
  pendingIdentityAction.value = null
  closeIdentityPrompt(false)

  if (action) {
    nextTick(() => {
      void runPendingIdentityAction(action)
    })
  }
}

function resetUsername() {
  username.value = ''
  usernameDraft.value = ''
  prizeQuestion.value = ''
  prizeQuestionDraft.value = ''
  prizeAnswer.value = ''
  prizeAnswerDraft.value = ''
  usernameError.value = ''
  setStoredUsername('')
  setStoredPrizeQuestion('')
  setStoredPrizeAnswer('')
}

function openIdentityPrompt(message = 'Set your username first.', action?: PendingIdentityAction) {
  if (username.value && hasPrizeVerification.value) return true
  if (action) pendingIdentityAction.value = action
  if (!identityPromptOpen.value) {
    lastFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null
  }
  identityPromptMessage.value = message
  usernameError.value = message
  identityPromptOpen.value = true
  nextTick(() => identityPrompt.value?.focus())
  return false
}

function closeIdentityPrompt(clearPendingAction = true) {
  identityPromptOpen.value = false
  if (clearPendingAction) pendingIdentityAction.value = null
}

function requireUsername(message = 'Set your username first.', action?: PendingIdentityAction) {
  if (username.value && hasPrizeVerification.value) return true
  return openIdentityPrompt(message, action)
}

function openPredictionModal() {
  if (scoreCtaDisabled.value) return
  if (!requireUsername('Set your username before posting.', { type: 'prediction' })) return
  if (!predictionModalOpen.value) {
    lastFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null
  }
  predictionModalOpen.value = true
  nextTick(() => scoreDrawer.value?.focus())
}

function closePredictionModal() {
  predictionModalOpen.value = false
}

function errorText(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

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
  if (filter === 'winner') return adminWinnerCount.value
  if (filter === 'pending') return adminPendingCount.value
  if (filter === 'verified') return adminVerifiedCount.value
  if (filter === 'missing') return adminMissingPickupCount.value
  return adminEntries.value.length
}

function adminFilterLabel(filter: AdminPrizeFilter) {
  return {
    all: 'All',
    winner: 'Winners',
    pending: 'Pending',
    verified: 'Has pickup',
    missing: 'No pickup',
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

function openAdminEntry(entry: PrizeDeskEntry) {
  selectedAdminEntryId.value = entry.id
}

function closeAdminEntry() {
  selectedAdminEntryId.value = ''
}

async function loadAdminPrizeDesk() {
  adminLoading.value = true
  adminError.value = ''

  try {
    const response = await fetchPrizeDeskEntries()
    const entries = [...response.entries].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
    adminEntries.value = entries
    if (selectedAdminEntryId.value && !entries.some((entry) => entry.id === selectedAdminEntryId.value)) {
      selectedAdminEntryId.value = ''
    }
  } catch (error) {
    adminError.value = errorText(error, 'Unable to load prize desk.')
  } finally {
    adminLoading.value = false
  }
}

function roomLoadReason() {
  return 'We could not load the room board just now. Give it a moment and try again.'
}

function roomLoadRecoveryHint() {
  return 'The match rooms are still here. We are just having trouble bringing the latest board onto the screen.'
}

function showMutationError(message: string) {
  mutationError.value = message
  if (mutationErrorTimer) window.clearTimeout(mutationErrorTimer)
  mutationErrorTimer = window.setTimeout(() => {
    mutationError.value = ''
  }, 4200)
}

async function showHome() {
  window.history.pushState(null, '', '/')
  routePath.value = '/'

  if (!rooms.value.length) {
    await bootstrap()
  }
}

function flagClass(team: Team) {
  return `flag fi fi-${teamFlagIso2(team)}`
}

function hasSpriteFlag(team: Team) {
  return !!teamFlagIso2(team)
}

function teamFlagIso2(team: Team) {
  return (team.iso2 || subdivisionFlagIso2(team.name, team.code)).toLowerCase()
}

function predictionAvatar(name: string) {
  const cached = avatarCache.get(name)
  if (cached) return cached

  const avatar = createNaviiIcon(name, `${name} avatar`)
  avatarCache.set(name, avatar)
  return avatar
}

function leadComment(prediction: Prediction) {
  return prediction.comments.find((comment) => comment.authorId === prediction.authorId) ?? null
}

function secondaryComments(prediction: Prediction) {
  const ownerLead = leadComment(prediction)
  return prediction.comments.filter((comment) => comment.id !== ownerLead?.id)
}

function threadEntries(prediction: Prediction) {
  const ownerLead = leadComment(prediction)
  const entries: Array<{
    id: string
    type: 'comment' | 'reply'
    name: string
    text: string
    createdAt: string
    editedAt?: string
  }> = []

  for (const comment of secondaryComments(prediction)) {
    entries.push({
      id: comment.id,
      type: 'comment',
      name: comment.name,
      text: comment.text,
      createdAt: comment.createdAt,
      editedAt: comment.editedAt,
    })

    for (const reply of comment.replies) {
      entries.push({
        id: reply.id,
        type: 'reply',
        name: reply.name,
        text: reply.text,
        createdAt: reply.createdAt,
        editedAt: reply.editedAt,
      })
    }
  }

  for (const reply of ownerLead?.replies ?? []) {
    entries.push({
      id: reply.id,
      type: 'reply',
      name: reply.name,
      text: reply.text,
      createdAt: reply.createdAt,
      editedAt: reply.editedAt,
    })
  }

  return entries.sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
}

function predictionCommentTotal(prediction: Prediction) {
  return prediction.comments.reduce((sum, comment) => sum + 1 + comment.replies.length, 0)
}

function percentOf(value: number, total: number) {
  if (total <= 0) return 0
  return Math.round((value / total) * 100)
}

function scoreKey(homeScore: number, awayScore: number) {
  return `${homeScore}-${awayScore}`
}

function scoreLabel(room: Room, homeScore: number, awayScore: number) {
  return `${room.home.code} ${homeScore}-${awayScore} ${room.away.code}`
}

function scorelineCount(room: Room, homeScore: number, awayScore: number) {
  const key = scoreKey(homeScore, awayScore)
  return room.predictions.filter((prediction) => scoreKey(prediction.homeScore, prediction.awayScore) === key).length
}

function formatWinnerNames(names: string[]) {
  const visible = names.slice(0, 4)
  const remaining = names.length - visible.length
  return `${visible.join(' · ')}${remaining > 0 ? ` · +${remaining} more` : ''}`
}

function roomSplit(room: Room) {
  return room.predictions.reduce(
    (split, prediction) => {
      if (prediction.homeScore > prediction.awayScore) split.home += 1
      else if (prediction.homeScore < prediction.awayScore) split.away += 1
      else split.draw += 1
      return split
    },
    { home: 0, draw: 0, away: 0 },
  )
}

function roomSplitPercentages(room: Room) {
  const split = roomSplit(room)
  const total = room.predictions.length

  return {
    counts: split,
    percentages: {
      home: percentOf(split.home, total),
      draw: percentOf(split.draw, total),
      away: percentOf(split.away, total),
    },
  }
}

function banterWeatherInsight(room: Room): TopPickInsight {
  const talk = totalComments.value
  const likes = totalLikes.value
  const picks = room.predictions.length
  const heat = talk * 2 + likes
  const weather = { picks, comments: talk, likes }

  if (heat >= 40) {
    return {
      key: 'weather',
      icon: '🌶️',
      label: 'Banter weather',
      value: 'Spicy',
      detail: `${picks} picks · ${talk} replies · ${likes} likes`,
      caption: 'Keep water nearby.',
      tone: 'hot',
      weather,
    }
  }

  if (heat >= 14) {
    return {
      key: 'weather',
      icon: '🌡️',
      label: 'Banter weather',
      value: 'Heating up',
      detail: `${picks} picks · ${talk} replies · ${likes} likes`,
      caption: talk > 0 ? 'Replies are stretching.' : 'Takes are warming up.',
      tone: 'sharp',
      weather,
    }
  }

  if (picks <= 1 && heat <= 2) {
    return {
      key: 'weather',
      icon: '🧊',
      label: 'Banter weather',
      value: 'Cold room',
      detail: `${picks} picks · ${talk} replies · ${likes} likes`,
      caption: 'First bold take gets the mic.',
      tone: 'calm',
      weather,
    }
  }

  return {
    key: 'weather',
    icon: '☁️',
    label: 'Banter weather',
    value: 'Calm',
    detail: `${picks} picks · ${talk} replies · ${likes} likes`,
    caption: 'Suspiciously polite.',
    tone: 'calm',
    weather,
  }
}

function buildTopPickInsights(room?: Room | null): TopPickInsight[] {
  if (!room || room.predictions.length === 0) {
    return [
      {
        key: 'empty',
        icon: '👀',
        label: 'Top pick',
        value: 'No top pick yet',
        detail: 'The room is waiting for the first brave score.',
        caption: 'Drop one and become the headline.',
        tone: 'empty',
      },
    ]
  }

  const total = room.predictions.length
  const topPickCount = scorelineCount(room, room.mostBacked.home, room.mostBacked.away)
  const topPickShare = percentOf(topPickCount, total)
  const topPickPredictors = [
    ...new Set(
      room.predictions
        .filter((prediction) => prediction.homeScore === room.mostBacked.home && prediction.awayScore === room.mostBacked.away)
        .map((prediction) => prediction.name.trim())
        .filter(Boolean),
    ),
  ]
  const topPickPredictorLabel = topPickPredictors.length > 1
    ? `${topPickPredictors[0]} +${topPickPredictors.length - 1} predicted it`
    : topPickPredictors[0]
      ? `${topPickPredictors[0]} predicted it`
      : 'Someone predicted it'
  const { counts: split, percentages } = roomSplitPercentages(room)
  const finalScore = finalScoreForRoom(room)
  const winners = finalScore
    ? room.predictions.filter((prediction) => isExactPick(prediction, finalScore))
    : []
  const winnerNames = [...new Set(winners.map((prediction) => prediction.name.trim()).filter(Boolean))]
  const winnerInsight: TopPickInsight | null = finalScore && winnerNames.length
    ? {
        key: 'winners',
        icon: '🏆',
        label: winnerNames.length === 1 ? 'Winner' : 'Winners',
        value: winnerNames.length === 1 ? `${winnerNames[0]} nailed it` : `${winnerNames.length} nailed it`,
        detail: formatWinnerNames(winnerNames),
        caption: `Exact on ${scoreLabel(room, finalScore.home, finalScore.away)}`,
        tone: 'winner',
        winners: {
          count: winnerNames.length,
          names: winnerNames,
          score: scoreLabel(room, finalScore.home, finalScore.away),
        },
      }
    : null

  return [
    {
      key: 'crowd',
      icon: '📣',
      label: 'Crowd pick',
      value: scoreLabel(room, room.mostBacked.home, room.mostBacked.away),
      detail: `${topPickCount}/${total} picks · ${topPickShare}% of the room`,
      caption: room.mostBacked.margin,
      tone: topPickShare >= 50 ? 'sharp' : 'split',
      crowd: {
        pickCount: topPickCount,
        total,
        share: topPickShare,
        predictorLabel: topPickPredictorLabel,
      },
    },
    ...(winnerInsight ? [winnerInsight] : []),
    {
      key: 'split',
      icon: '⚖️',
      label: 'Room split',
      value: `${room.home.code} ${percentages.home}% · Draw ${percentages.draw}% · ${room.away.code} ${percentages.away}%`,
      detail: `${split.home} backing ${room.home.code} · ${split.draw} draw · ${split.away} backing ${room.away.code}`,
      caption: split.draw >= Math.max(split.home, split.away) ? 'The draw gang has entered the chat.' : 'The room has picked a direction.',
      tone: 'split',
      split: {
        home: percentages.home,
        draw: percentages.draw,
        away: percentages.away,
        homeLabel: room.home.code,
        awayLabel: room.away.code,
      },
    },
    banterWeatherInsight(room),
  ]
}

function isCommentsExpanded(predictionId: string) {
  return expandedCommentCards.value.has(predictionId)
}

function isFastCollapsingComments(predictionId: string) {
  return fastCollapsingCommentCards.value.has(predictionId)
}

function isRoomRecentlyUpdated(roomId: string) {
  return updatedRoomIds.value.has(roomId)
}

function isPredictionRecentlyUpdated(predictionId: string) {
  return updatedPredictionIds.value.has(predictionId)
}

function isOptimisticReply(replyId: string) {
  return replyId.startsWith('optimistic-reply-')
}

function isOptimisticPrediction(predictionId: string) {
  return predictionId.startsWith('optimistic-prediction-')
}

function showsFullThread(prediction: Prediction) {
  return isCommentsExpanded(prediction.id)
}

function visibleThreadEntries(prediction: Prediction) {
  const entries = threadEntries(prediction)
  return showsFullThread(prediction) ? entries : entries.slice(0, COMMENT_PREVIEW_LIMIT)
}

function hiddenReplyCount(prediction: Prediction) {
  const entries = threadEntries(prediction)
  return Math.max(0, entries.length - COMMENT_PREVIEW_LIMIT)
}

function shouldShowCommentToggle(prediction: Prediction) {
  return (
    !isReplying(prediction.id, replyTargetIdForPrediction(prediction)) &&
    !isReplyComposerClosing(prediction.id, replyTargetIdForPrediction(prediction)) &&
    hiddenReplyCount(prediction) > 0
  )
}

function shouldFadeCommentPreview(prediction: Prediction) {
  return shouldShowCommentToggle(prediction) && !isCommentsExpanded(prediction.id)
}

function replyComposerLabel(prediction: Prediction) {
  return leadComment(prediction) ? 'Reply' : 'Add a comment'
}

function replyComposerPlaceholder(prediction: Prediction) {
  if (leadComment(prediction)) return 'Keep it light...'
  return threadEntries(prediction).length ? 'Join the thread...' : 'Start the thread...'
}

function replyActionLabel(prediction: Prediction) {
  if (leadComment(prediction)) {
    return `Reply to ${prediction.name}. ${predictionCommentTotal(prediction)} comments and replies`
  }

  if (threadEntries(prediction).length) {
    return `Comment under ${prediction.name}'s prediction. ${predictionCommentTotal(prediction)} comments in thread.`
  }

  return `Comment on ${prediction.name}'s prediction. Start the thread.`
}

function replySubmitLabel(prediction: Prediction) {
  return leadComment(prediction) ? 'Reply' : 'Comment'
}

function roomKickoffMs(room: Room) {
  return roomKickoffMsByState(room, fixtureKickoffs)
}

function roomCycleDateKey(kickoffMs: number, cycleStartHourUtc = DEFAULT_MATCH_CYCLE_START_HOUR_UTC) {
  const shifted = new Date(kickoffMs - cycleStartHourUtc * 60 * 60 * 1000)
  return shifted.toISOString().slice(0, 10)
}

function roomCycleStartMs(cycleKey: string, cycleStartHourUtc = DEFAULT_MATCH_CYCLE_START_HOUR_UTC) {
  const [year, month, day] = cycleKey.split('-').map(Number)
  return Date.UTC(year, (month || 1) - 1, day || 1, cycleStartHourUtc, 0, 0)
}

function roomBucketLabel(cycleKey: string, currentCycleKey: string) {
  const dayDelta = Math.round((roomCycleStartMs(cycleKey) - roomCycleStartMs(currentCycleKey)) / (24 * 60 * 60 * 1000))
  if (dayDelta === 1) return 'Tomorrow'
  if (dayDelta === 0) return 'Today'
  if (dayDelta === -1) return 'Yesterday'

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
  }).format(new Date(`${cycleKey}T12:00:00.000Z`))
}

function effectiveRoomMatchStatus(room: Room) {
  return effectiveRoomMatchStatusByState(room, { fixtureKickoffs })
}

function finalScoreForRoom(room?: Room | null) {
  if (!room || effectiveRoomMatchStatus(room) !== 'finished') return null
  if (!room.currentScore || room.currentScore.status !== 'finished') return null
  return {
    home: room.currentScore.home,
    away: room.currentScore.away,
  }
}

function isExactPick(prediction: Prediction, score = activeRoomFinalScore.value) {
  return !!score && prediction.homeScore === score.home && prediction.awayScore === score.away
}

function showsLiveRoomIcon(room: Room) {
  return effectiveRoomMatchStatus(room) === 'live'
}

function roomKickoffTime(room: Room) {
  return roomKickoffTimeByState(room, fixtureKickoffs)
}

function roomStatusLabel(room: Room) {
  const matchStatus = effectiveRoomMatchStatus(room)
  if (room.currentScore) {
    return `${room.currentScore.status === 'finished' ? 'Finished match' : room.currentScore.status === 'live' ? 'Live match' : 'Score'}: ${room.home.name} ${room.currentScore.home}, ${room.away.name} ${room.currentScore.away}`
  }
  if (matchStatus === 'live') return 'Live match'
  if (room.roomStatus === 'closed') return 'Closed room'
  if (matchStatus === 'finished') return 'Finished match'
  return 'Upcoming match'
}

function roomStatusText(room: Room) {
  const matchStatus = effectiveRoomMatchStatus(room)
  if (room.currentScore) {
    const prefix = room.currentScore.status === 'finished' ? 'FT' : room.currentScore.status === 'live' ? 'Live' : 'Score'
    return `${prefix} ${room.currentScore.home}-${room.currentScore.away}`
  }
  if (matchStatus === 'live') return 'Live'
  if (matchStatus === 'finished') return 'Played'
  if (room.roomStatus === 'closed') return 'Closed'
  return 'Upcoming'
}

function mobileRoomStatusText(room: Room) {
  const matchStatus = effectiveRoomMatchStatus(room)
  if (matchStatus === 'live') return 'Live'
  if (matchStatus === 'finished' || room.roomStatus === 'closed') return ''
  return roomKickoffTime(room) || 'Soon'
}

function roomStatusClass(room: Room) {
  const matchStatus = effectiveRoomMatchStatus(room)
  if (matchStatus === 'live') {
    return 'border-[color:color-mix(in_srgb,var(--accent)_34%,var(--line))] bg-[color:color-mix(in_srgb,var(--accent)_12%,transparent)] text-[var(--accent)]'
  }

  if (matchStatus === 'finished') {
    return 'border-[color:color-mix(in_srgb,var(--muted)_22%,var(--line))] bg-[color:color-mix(in_srgb,var(--muted)_8%,transparent)] text-[var(--muted)]'
  }

  return 'border-[color:color-mix(in_srgb,var(--line)_82%,transparent)] bg-[color:color-mix(in_srgb,var(--chip-bg)_52%,transparent)] text-[var(--soft)]'
}

function draftTargetIdForPrediction(predictionId: string) {
  return `prediction:${predictionId}`
}

function isPredictionDraftTarget(targetId: string) {
  return targetId.startsWith('prediction:')
}

function predictionIdForReplyTarget(targetId: string) {
  return isPredictionDraftTarget(targetId) ? targetId.slice('prediction:'.length) : predictionIdForComment(targetId)
}

function replyTargetIdForPrediction(prediction: Prediction) {
  return leadComment(prediction)?.id ?? draftTargetIdForPrediction(prediction.id)
}

function isReplying(predictionId: string, targetId: string) {
  return (
    activeReplyTarget.value?.predictionId === predictionId &&
    activeReplyTarget.value?.targetId === targetId
  )
}

function replyTargetKey(predictionId: string, targetId: string) {
  return `${predictionId}:${targetId}`
}

function isReplyComposerClosing(predictionId: string, targetId: string) {
  return closingReplyTargets.value.has(replyTargetKey(predictionId, targetId))
}

function markReplyComposerClosing(targetId: string) {
  const predictionId = activeReplyTarget.value?.targetId === targetId
    ? activeReplyTarget.value.predictionId
    : predictionIdForReplyTarget(targetId)

  if (!predictionId) return

  closingReplyTargets.value = new Set(closingReplyTargets.value).add(replyTargetKey(predictionId, targetId))
}

function finishReplyComposerClose(predictionId: string, targetId: string) {
  const nextClosing = new Set(closingReplyTargets.value)
  nextClosing.delete(replyTargetKey(predictionId, targetId))
  closingReplyTargets.value = nextClosing
}

function isReplySubmitting(targetId: string) {
  return submittingReplies.value.has(targetId)
}

function isEditSubmitting(contentId: string) {
  return submittingEdits.value.has(contentId)
}

function canSubmitReply(targetId: string) {
  return !isReplySubmitting(targetId) && !!(replyDrafts[targetId] || '').trim()
}

function hasReplyDraft(targetId: string) {
  return !!(replyDrafts[targetId] || '').trim()
}

function typingKey(target: TypingTarget, targetId: string, id = userId) {
  return `${target}:${targetId}:${id}`
}

function typingLabel(target: TypingTarget, targetId: string) {
  const now = Date.now()
  const names = [...typingPeople.value.values()]
    .filter((person) => person.target === target && person.targetId === targetId && person.expiresAt > now)
    .map((person) => person.name)
    .slice(0, 3)

  if (names.length === 0) return ''
  if (names.length === 1) return `${names[0]} is typing...`
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing...`
  return `${names[0]}, ${names[1]} and others are typing...`
}

function roomAllowsTextEditing() {
  return !!activeRoom.value && effectiveRoomMatchStatus(activeRoom.value) !== 'finished' && activeRoom.value.roomStatus === 'open'
}

function canEditReply(reply: Reply) {
  return reply.authorId === userId && roomAllowsTextEditing() && !reply.id.startsWith('optimistic-')
}

function canSubmitEdit(contentId: string, minLength = 1) {
  return !isEditSubmitting(contentId) && (editDrafts[contentId] || '').trim().length >= minLength
}

function setActiveRoom(roomId: string) {
  const currentIndex = orderedRooms.value.findIndex((room) => room.id === activeRoomId.value)
  const nextIndex = orderedRooms.value.findIndex((room) => room.id === roomId)
  if (currentIndex !== -1 && nextIndex !== -1 && currentIndex !== nextIndex) {
    roomSwitchDirection.value = nextIndex > currentIndex ? 'forward' : 'backward'
  }
  const room = orderedRooms.value.find((item) => item.id === roomId)
  if (room) {
    selectedRoomBucketKey.value = roomCycleDateKey(roomKickoffMs(room))
  }
  activeRoomId.value = roomId
  activeReplyTarget.value = null
  closingReplyTargets.value = new Set()
  expandedCommentCards.value = new Set()
  fastCollapsingCommentCards.value = new Set()
  editingReplyId.value = ''
  clearTypingState()
}

function selectRoomBucket(bucketKey: string) {
  const bucket = roomDayBuckets.value.find((item) => item.key === bucketKey)
  if (!bucket) return

  selectedRoomBucketKey.value = bucket.key
  if (bucket.rooms.some((room) => room.id === activeRoomId.value)) return

  const nextRoom = bucket.rooms.find((room) => room.isFeatured) ?? bucket.rooms[0]
  if (nextRoom) {
    setActiveRoom(nextRoom.id)
  }
}

function previousRoomPage() {
  if (!leftRoomBucket.value) return
  selectRoomBucket(leftRoomBucket.value.key)
}

function nextRoomPage() {
  if (!rightRoomBucket.value) return
  selectRoomBucket(rightRoomBucket.value.key)
}

function toggleFeedSort() {
  if (!canSortPredictions.value) return
  feedSortMode.value = feedSortMode.value === 'likes' ? 'comments' : 'likes'
}

function formatMargin(homeName: string, awayName: string, homeScore: number, awayScore: number) {
  if (homeScore === awayScore) return 'Draw backed most'
  const side = homeScore > awayScore ? homeName : awayName
  return `${side} by ${Math.abs(homeScore - awayScore)}`
}

async function submitPrediction() {
  if (submittingPrediction.value) return
  if (!activeRoom.value || !requireUsername('Set your username before posting.')) return
  if (activeRoomPredictionsClosed.value) {
    closePredictionModal()
    return
  }
  if (!canSubmitPrediction.value) return

  const roomId = activeRoom.value.id
  const submittedComment = predictionForm.comment.trim()
  const payload: CreatePredictionInput = {
    authorId: userId,
    name: username.value,
    homeScore: predictionForm.homeScore,
    awayScore: predictionForm.awayScore,
    comment: submittedComment || undefined,
    prizeQuestion: prizeQuestion.value,
    prizeAnswer: prizeAnswer.value,
  }
  const optimisticPrediction: Prediction = {
    id: `optimistic-prediction-${roomId}-${Date.now()}`,
    authorId: userId,
    name: username.value,
    homeScore: predictionForm.homeScore,
    awayScore: predictionForm.awayScore,
    likes: 0,
    createdAt: new Date().toISOString(),
    comments: submittedComment
      ? [
          {
            id: `optimistic-comment-${roomId}-${Date.now()}`,
            authorId: userId,
            name: username.value,
            text: submittedComment,
            replies: [],
            createdAt: new Date().toISOString(),
          },
        ]
      : [],
  }

  submittingPrediction.value = true
  closePredictionModal()
  addLocalPrediction(roomId, optimisticPrediction)

  try {
    const response = await createPrediction(roomId, payload)
    patchRoom(response.room)
    predictionForm.comment = ''
    predictionDrafts[roomId] = ''
    setStoredPredictionDrafts({ ...predictionDrafts })
  } catch (error) {
    removeLocalPrediction(optimisticPrediction.id)
    predictionModalOpen.value = !!activeRoom.value && activeRoom.value.id === roomId
    showMutationError(errorText(error, 'Prediction did not post. Try again.'))
  } finally {
    submittingPrediction.value = false
  }
}

async function submitLike(predictionId: string, authorId?: string) {
  if (!requireUsername('Set your username before liking.', { type: 'like', predictionId, authorId })) return

  const previousLikes = new Set(likedPredictions.value)
  const nextLikes = new Set(likedPredictions.value)
  const liked = !nextLikes.has(predictionId)

  if (liked) {
    nextLikes.add(predictionId)
  } else {
    nextLikes.delete(predictionId)
  }

  likedPredictions.value = nextLikes
  setStoredLikes(nextLikes)
  updateLocalPrediction(predictionId, (prediction) => ({
    ...prediction,
    likes: Math.max(0, prediction.likes + (liked ? 1 : -1)),
  }))

  try {
    const response = await togglePredictionLike(predictionId, { userId, liked })
    patchRoom(response.room)
  } catch (error) {
    likedPredictions.value = previousLikes
    setStoredLikes(previousLikes)
    updateLocalPrediction(predictionId, (prediction) => ({
      ...prediction,
      likes: Math.max(0, prediction.likes + (liked ? -1 : 1)),
    }))
    showMutationError(errorText(error, 'Like did not update. Try again.'))
  }
}

function openReplyComposer(predictionId: string, targetId: string) {
  fastCollapsingCommentCards.value = new Set()
  editingReplyId.value = ''
  finishReplyComposerClose(predictionId, targetId)
  activeReplyTarget.value = { predictionId, targetId }
  nextTick(() => {
    focusReplyInput(targetId)
  })
}

function closeReplyComposer(targetId: string) {
  stopTyping('reply', targetId)
  markReplyComposerClosing(targetId)
  activeReplyTarget.value = null
}

function startEditingReply(reply: Reply) {
  if (!canEditReply(reply)) return
  activeReplyTarget.value = null
  editingReplyId.value = reply.id
  editDrafts[reply.id] = reply.text
  editErrors[reply.id] = ''
  nextTick(() => focusEditInput(reply.id))
}

function cancelEdit(contentId: string) {
  if (editingReplyId.value === contentId) editingReplyId.value = ''
  editErrors[contentId] = ''
}

function focusEditInput(contentId: string) {
  const input = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[data-edit-key="${CSS.escape(contentId)}"]`)
  input?.focus()
  input?.select()
}

function toggleReply(predictionId: string, targetId: string) {
  if (!requireUsername('Set your username before replying.', { type: 'reply', predictionId, targetId })) return
  if (isReplying(predictionId, targetId)) {
    if (isMobileViewport()) {
      focusReplyInput(targetId)
      return
    }

    closeReplyComposer(targetId)
    return
  }

  openReplyComposer(predictionId, targetId)
}

function sendTyping(target: TypingTarget, targetId: string, active: boolean) {
  if (!activeRoom.value || !username.value || ws.value?.readyState !== WebSocket.OPEN) return

  const event: TypingEvent = {
    type: 'typing',
    roomId: activeRoom.value.id,
    userId,
    name: username.value,
    target,
    targetId,
    active,
    at: new Date().toISOString(),
  }

  ws.value.send(JSON.stringify(event))
}

function markTyping(target: TypingTarget, targetId: string) {
  if (!username.value) return

  const key = typingKey(target, targetId)
  const now = Date.now()
  const lastSentAt = lastTypingSentAt.get(key) ?? 0

  if (now - lastSentAt > TYPING_THROTTLE_MS) {
    sendTyping(target, targetId, true)
    lastTypingSentAt.set(key, now)
  }

  const existingTimer = typingStopTimers.get(key)
  if (existingTimer) window.clearTimeout(existingTimer)

  typingStopTimers.set(key, window.setTimeout(() => {
    stopTyping(target, targetId)
  }, TYPING_IDLE_MS))
}

function stopTyping(target: TypingTarget, targetId: string) {
  const key = typingKey(target, targetId)
  const existingTimer = typingStopTimers.get(key)
  if (existingTimer) window.clearTimeout(existingTimer)
  typingStopTimers.delete(key)
  lastTypingSentAt.delete(key)
  sendTyping(target, targetId, false)
}

function clearTypingState() {
  for (const timer of typingStopTimers.values()) {
    window.clearTimeout(timer)
  }

  typingStopTimers.clear()
  lastTypingSentAt.clear()
  typingPeople.value = new Map()

  if (typingCleanupTimer) {
    window.clearTimeout(typingCleanupTimer)
    typingCleanupTimer = null
  }
}

function cleanupTypingPeople() {
  const now = Date.now()
  const next = new Map(
    [...typingPeople.value.entries()].filter(([, person]) => person.expiresAt > now),
  )

  typingPeople.value = next

  if (typingCleanupTimer) {
    window.clearTimeout(typingCleanupTimer)
    typingCleanupTimer = null
  }

  const nextExpiry = Math.min(...[...next.values()].map((person) => person.expiresAt))
  if (Number.isFinite(nextExpiry)) {
    typingCleanupTimer = window.setTimeout(cleanupTypingPeople, Math.max(120, nextExpiry - Date.now()))
  }
}

function handleTypingEvent(event: TypingEvent) {
  if (event.roomId !== activeRoom.value?.id || event.userId === userId) return

  const key = typingKey(event.target, event.targetId, event.userId)
  const next = new Map(typingPeople.value)

  if (!event.active) {
    next.delete(key)
    typingPeople.value = next
    return
  }

  next.set(key, {
    userId: event.userId,
    name: event.name,
    target: event.target,
    targetId: event.targetId,
    expiresAt: Date.now() + TYPING_VISIBLE_MS,
  })
  typingPeople.value = next
  cleanupTypingPeople()
}

function focusReplyInput(targetId: string) {
  const input = document.querySelector<HTMLInputElement>(`input[data-reply-key="${CSS.escape(targetId)}"]`)
  focusReplyElement(input)
}

function focusReplyComposer(element: Element) {
  focusReplyElement(element.querySelector<HTMLInputElement>('input[data-reply-key]'))
}

function isMobileViewport() {
  return isMobileViewportState.value
}

function syncViewportState() {
  isMobileViewportState.value = window.matchMedia('(max-width: 767px)').matches
}

function updateFeedNavMode() {
  if (!isMobileViewport() || !sortedPredictions.value.length) {
    feedNavMode.value = 'hidden'
    return
  }

  const feed = predictionFeed.value
  const list = predictionFeedList.value
  if (!feed || !list) {
    feedNavMode.value = 'hidden'
    return
  }

  const feedRect = feed.getBoundingClientRect()
  const listRect = list.getBoundingClientRect()
  const viewportHeight = window.visualViewport?.height ?? window.innerHeight
  const feedIsVisible = feedRect.top < viewportHeight - 120 && listRect.bottom > 120
  const feedHasRoomToScroll = listRect.height > viewportHeight * 0.58 || listRect.bottom > viewportHeight + 140

  if (!feedIsVisible || !feedHasRoomToScroll) {
    feedNavMode.value = 'hidden'
    return
  }

  feedNavMode.value = listRect.top > 130 ? 'down' : 'up'
}

function scrollPredictionFeed(direction: 'up' | 'down') {
  if (direction === 'up') {
    const target = predictionFeedList.value ?? predictionFeed.value
    if (!target) return

    const top = window.scrollY + target.getBoundingClientRect().top - 12
    window.scrollTo({
      top: Math.max(0, top),
      behavior: 'smooth',
    })
    return
  }

  const target = predictionFeedList.value?.lastElementChild
  target?.scrollIntoView({
    behavior: 'smooth',
    block: 'end',
  })
}

function handleFeedNavClick() {
  if (feedNavMode.value === 'hidden') return
  scrollPredictionFeed(feedNavMode.value)
}

function clearReplyFocusTimers() {
  replyFocusTimers.forEach((timer) => window.clearTimeout(timer))
  replyFocusTimers = []
}

function focusReplyElement(input: HTMLInputElement | null) {
  if (!input) return

  if (!isMobileViewport()) {
    input.focus()
    return
  }

  clearReplyFocusTimers()
  alignReplyComposerWithViewport(input, 'auto')
  input.focus({ preventScroll: true })
  replyFocusTimers = [120, 360].map((delay) =>
    window.setTimeout(() => {
      alignReplyComposerWithViewport(input)
    }, delay),
  )
}

function alignReplyComposerWithViewport(input: HTMLInputElement, behavior: ScrollBehavior = 'smooth') {
  const composer = input.closest<HTMLElement>('[data-reply-composer]') ?? input
  const viewport = window.visualViewport
  const viewportTop = viewport?.offsetTop ?? 0
  const viewportHeight = viewport?.height ?? window.innerHeight
  const viewportBottom = viewportTop + viewportHeight
  const rect = composer.getBoundingClientRect()
  const topInset = 92
  const bottomInset = 28

  if (rect.top < topInset) {
    window.scrollBy({
      top: rect.top - topInset,
      behavior,
    })
    return
  }

  const overflow = rect.bottom - (viewportBottom - bottomInset)
  if (overflow > 0) {
    window.scrollBy({
      top: overflow + 48,
      behavior,
    })
  }
}

async function runPendingIdentityAction(action: PendingIdentityAction) {
  if (action.type === 'prediction') {
    openPredictionModal()
    return
  }

  if (action.type === 'reply') {
    openReplyComposer(action.predictionId, action.targetId)
    return
  }

  await submitLike(action.predictionId, action.authorId)
}

function toggleComments(predictionId: string) {
  if (expandedCommentCards.value.has(predictionId)) {
    if (fastCommentCollapseTimer) {
      window.clearTimeout(fastCommentCollapseTimer)
    }
    fastCollapsingCommentCards.value = new Set([predictionId])
    expandedCommentCards.value = new Set()
    fastCommentCollapseTimer = window.setTimeout(() => {
      fastCollapsingCommentCards.value = new Set()
      fastCommentCollapseTimer = null
    }, 140)
  } else {
    fastCollapsingCommentCards.value = new Set()
    expandedCommentCards.value = new Set([predictionId])
  }
}

async function submitReply(targetId: string) {
  if (!requireUsername('Set your username before replying.')) return
  const text = (replyDrafts[targetId] || '').trim()
  if (!text || isReplySubmitting(targetId)) return

  const predictionId = predictionIdForReplyTarget(targetId)
  if (!predictionId) return

  const isFirstComment = isPredictionDraftTarget(targetId)
  const payload: ReplyInput | PredictionCommentInput = {
    authorId: userId,
    name: username.value,
    text,
  }
  const optimisticReply: Reply = {
    id: `optimistic-reply-${targetId}-${Date.now()}`,
    authorId: userId,
    name: username.value,
    text,
    createdAt: new Date().toISOString(),
  }
  const optimisticComment: PredictionComment = {
    id: `optimistic-comment-${predictionId}-${Date.now()}`,
    authorId: userId,
    name: username.value,
    text,
    replies: [],
    createdAt: new Date().toISOString(),
  }

  submittingReplies.value = new Set(submittingReplies.value).add(targetId)
  replyErrors[targetId] = ''
  replyDrafts[targetId] = ''
  stopTyping('reply', targetId)
  markReplyComposerClosing(targetId)
  activeReplyTarget.value = null
  if (isFirstComment) {
    updateLocalPrediction(predictionId, (prediction) => ({
      ...prediction,
      comments: [optimisticComment, ...prediction.comments],
    }))
  } else {
    updateLocalReplyThread(targetId, (replies) => [...replies, optimisticReply])
  }

  try {
    const response = isFirstComment
      ? await createPredictionComment(predictionId, payload as PredictionCommentInput)
      : await createReply(targetId, payload as ReplyInput)
    patchRoom(response.room)
  } catch (error) {
    if (isFirstComment) {
      updateLocalPrediction(predictionId, (prediction) => ({
        ...prediction,
        comments: prediction.comments.filter((comment) => comment.id !== optimisticComment.id),
      }))
    } else {
      removeLocalReply(optimisticReply.id)
    }
    replyDrafts[targetId] = text
    activeReplyTarget.value = { predictionId, targetId }
    replyErrors[targetId] = errorText(error, isFirstComment ? 'Comment did not send. Try again.' : 'Reply did not send. Try again.')
    showMutationError(replyErrors[targetId])
  } finally {
    const nextSubmitting = new Set(submittingReplies.value)
    nextSubmitting.delete(targetId)
    submittingReplies.value = nextSubmitting
  }
}

async function submitReplyEdit(reply: Reply) {
  const text = (editDrafts[reply.id] || '').trim()
  if (!text || isEditSubmitting(reply.id) || !canEditReply(reply)) return

  const previousReply: Reply = { ...reply }
  const editedAt = new Date().toISOString()
  const nextSubmitting = new Set(submittingEdits.value)
  nextSubmitting.add(reply.id)
  submittingEdits.value = nextSubmitting
  editErrors[reply.id] = ''
  updateLocalReply(reply.id, (item) => ({ ...item, text, editedAt }))
  editingReplyId.value = ''

  try {
    const response = await updateReply(reply.id, { userId, text })
    patchRoom(response.room)
  } catch (error) {
    updateLocalReply(reply.id, () => previousReply)
    editingReplyId.value = reply.id
    editDrafts[reply.id] = text
    editErrors[reply.id] = errorText(error, 'Reply edit did not save. Try again.')
    showMutationError(editErrors[reply.id])
  } finally {
    const next = new Set(submittingEdits.value)
    next.delete(reply.id)
    submittingEdits.value = next
  }
}

function patchRoom(nextRoom: Room) {
  const previousRoom = rooms.value.find((room) => room.id === nextRoom.id)
  if (previousRoom && roomPulseSignature(previousRoom) !== roomPulseSignature(nextRoom)) {
    const previousPredictions = predictionPulseSignatures(previousRoom)
    const nextPredictions = predictionPulseSignatures(nextRoom)
    const changedPredictionIds = nextRoom.predictions
      .filter((prediction) => previousPredictions.get(prediction.id) !== nextPredictions.get(prediction.id))
      .map((prediction) => prediction.id)
    markRoomUpdated(nextRoom.id, changedPredictionIds)
  }

  const existing = rooms.value.some((room) => room.id === nextRoom.id)
  rooms.value = existing
    ? rooms.value.map((room) => (room.id === nextRoom.id ? nextRoom : room))
    : [nextRoom, ...rooms.value]

  if (!activeRoomId.value) {
    activeRoomId.value = nextRoom.id
  }
}

function updateLocalPrediction(predictionId: string, update: (prediction: Prediction) => Prediction) {
  let changed = false

  const nextRooms = rooms.value.map((room) => {
    let roomChanged = false
    const predictions = room.predictions.map((prediction) => {
      if (prediction.id !== predictionId) return prediction
      changed = true
      roomChanged = true
      return update(prediction)
    })

    return roomChanged ? { ...room, predictions } : room
  })

  if (changed) {
    rooms.value = nextRooms
  }
}

function addLocalPrediction(roomId: string, prediction: Prediction) {
  rooms.value = rooms.value.map((room) => {
    if (room.id !== roomId) return room

    return {
      ...room,
      mostBacked: {
        home: prediction.homeScore,
        away: prediction.awayScore,
        margin: formatMargin(room.home.name, room.away.name, prediction.homeScore, prediction.awayScore),
      },
      predictions: [prediction, ...room.predictions],
    }
  })
}

function removeLocalPrediction(predictionId: string) {
  rooms.value = rooms.value.map((room) => {
    const predictions = room.predictions.filter((prediction) => prediction.id !== predictionId)
    return predictions.length === room.predictions.length ? room : { ...room, predictions }
  })
}

function updateLocalReplyThread(commentId: string, update: (replies: Reply[]) => Reply[]) {
  let changed = false

  const nextRooms = rooms.value.map((room) => {
    let roomChanged = false
    const predictions = room.predictions.map((prediction) => {
      let predictionChanged = false
      const comments = prediction.comments.map((comment) => {
        if (comment.id !== commentId) return comment
        changed = true
        roomChanged = true
        predictionChanged = true
        return {
          ...comment,
          replies: update(comment.replies),
        }
      })

      return predictionChanged ? { ...prediction, comments } : prediction
    })

    return roomChanged ? { ...room, predictions } : room
  })

  if (changed) {
    rooms.value = nextRooms
  }
}

function updateLocalReply(replyId: string, update: (reply: Reply) => Reply) {
  let changed = false

  const nextRooms = rooms.value.map((room) => {
    let roomChanged = false
    const predictions = room.predictions.map((prediction) => {
      let predictionChanged = false
      const comments = prediction.comments.map((comment) => {
        let commentChanged = false
        const replies = comment.replies.map((reply) => {
          if (reply.id !== replyId) return reply
          changed = true
          roomChanged = true
          predictionChanged = true
          commentChanged = true
          return update(reply)
        })

        return commentChanged ? { ...comment, replies } : comment
      })

      return predictionChanged ? { ...prediction, comments } : prediction
    })

    return roomChanged ? { ...room, predictions } : room
  })

  if (changed) {
    rooms.value = nextRooms
  }
}

function removeLocalReply(replyId: string) {
  let changed = false

  const nextRooms = rooms.value.map((room) => {
    let roomChanged = false
    const predictions = room.predictions.map((prediction) => {
      let predictionChanged = false
      const comments = prediction.comments.map((comment) => {
        const replies = comment.replies.filter((reply) => reply.id !== replyId)
        if (replies.length === comment.replies.length) return comment
        changed = true
        roomChanged = true
        predictionChanged = true
        return { ...comment, replies }
      })

      return predictionChanged ? { ...prediction, comments } : prediction
    })

    return roomChanged ? { ...room, predictions } : room
  })

  if (changed) {
    rooms.value = nextRooms
  }
}

function predictionIdForComment(commentId: string) {
  for (const room of rooms.value) {
    for (const prediction of room.predictions) {
      if (prediction.comments.some((comment) => comment.id === commentId)) {
        return prediction.id
      }
    }
  }

  return ''
}

function replyById(prediction: Prediction, replyId: string) {
  for (const comment of prediction.comments) {
    const reply = comment.replies.find((item) => item.id === replyId)
    if (reply) return reply
  }

  return null
}

function selectedThemeLabel() {
  return mockThemes.find((theme) => theme.id === selectedTheme.value)?.label ?? 'Paper Notes'
}

function updateFavicon(themeId: ThemeId) {
  const theme = faviconThemes[themeId] ?? faviconThemes.paper
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
      <rect width="64" height="64" rx="32" fill="${theme.accent}"/>
      <circle cx="32" cy="32" r="25" fill="none" stroke="${theme.panel}" stroke-width="3" opacity=".36"/>
      <path d="M18 22.5c0-3.6 2.9-6.5 6.5-6.5h15c3.6 0 6.5 2.9 6.5 6.5v12c0 3.6-2.9 6.5-6.5 6.5H32l-8.5 7v-7c-3.1-.5-5.5-3.2-5.5-6.5v-12Z" fill="${theme.panel}"/>
      <path d="M23 29h6m12 0h-6m-3-3v6" stroke="${theme.text}" stroke-width="4" stroke-linecap="round"/>
      <circle cx="24" cy="35" r="2.4" fill="${theme.accent}"/>
      <circle cx="40" cy="35" r="2.4" fill="${theme.accent}"/>
    </svg>
  `.trim()
  const href = `data:image/svg+xml,${encodeURIComponent(svg)}`
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')

  if (!link) {
    link = document.createElement('link')
    link.rel = 'icon'
    document.head.append(link)
  }

  link.type = 'image/svg+xml'
  link.href = href
}

function positionThemeMenu() {
  const trigger = themeTrigger.value
  if (!trigger) return

  const rect = trigger.getBoundingClientRect()
  const width = Math.max(rect.width, 220)
  const left = Math.min(
    Math.max(12, rect.right - width),
    window.innerWidth - width - 12,
  )

  themeMenuStyle.value = {
    width: `${width}px`,
    left: `${left}px`,
    top: `${rect.bottom + 8}px`,
    maxHeight: `${Math.max(160, window.innerHeight - rect.bottom - 20)}px`,
  }
}

function toggleThemeMenu() {
  themeMenuOpen.value = !themeMenuOpen.value
  if (!themeMenuOpen.value) {
    clearThemePreview()
  }
}

function applyTheme(themeId: ThemeId) {
  clearThemePreview()
  selectedTheme.value = themeId
  themeMenuOpen.value = false
  themeTrigger.value?.focus({ preventScroll: true })
}

function previewTheme(themeId: ThemeId) {
  if (themePreviewTimer) {
    window.clearTimeout(themePreviewTimer)
  }
  themePreviewTimer = window.setTimeout(() => {
    themePreview.value = themeId
  }, 90)
}

function clearThemePreview() {
  if (themePreviewTimer) {
    window.clearTimeout(themePreviewTimer)
    themePreviewTimer = null
  }
  themePreview.value = null
}

function handleGlobalClick(event: MouseEvent) {
  const target = event.target as HTMLElement | null
  if (!target?.closest('.ui-select')) {
    themeMenuOpen.value = false
    clearThemePreview()
  }
}

function themeOptionId(index: number) {
  return `theme-option-${index}`
}

function setThemeOptionRef(element: HTMLButtonElement | null, index: number) {
  if (!element) return
  themeOptionRefs.value[index] = element
}

function focusThemeOption(index: number) {
  const nextIndex = Math.max(0, Math.min(mockThemes.length - 1, index))
  highlightedThemeIndex.value = nextIndex
  themeOptionRefs.value[nextIndex]?.focus()
}

function openThemeMenuWithFocus(index = highlightedThemeIndex.value) {
  themeMenuOpen.value = true
  highlightedThemeIndex.value = Math.max(0, Math.min(mockThemes.length - 1, index))
}

function handleThemeTriggerKeydown(event: KeyboardEvent) {
  if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    openThemeMenuWithFocus(mockThemes.findIndex((theme) => theme.id === selectedTheme.value))
    return
  }

  if (event.key === 'ArrowUp') {
    event.preventDefault()
    openThemeMenuWithFocus(mockThemes.length - 1)
  }
}

function handleThemeOptionKeydown(event: KeyboardEvent, index: number) {
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    focusThemeOption((index + 1) % mockThemes.length)
    return
  }

  if (event.key === 'ArrowUp') {
    event.preventDefault()
    focusThemeOption((index - 1 + mockThemes.length) % mockThemes.length)
    return
  }

  if (event.key === 'Home') {
    event.preventDefault()
    focusThemeOption(0)
    return
  }

  if (event.key === 'End') {
    event.preventDefault()
    focusThemeOption(mockThemes.length - 1)
    return
  }

  if (event.key === 'Escape') {
    event.preventDefault()
    themeMenuOpen.value = false
    clearThemePreview()
    themeTrigger.value?.focus({ preventScroll: true })
  }
}

function currentOverlayElement() {
  return document.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"]')
}

function getFocusableElements(container: HTMLElement) {
  return [...container.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])')]
    .filter((element) => !element.hasAttribute('hidden') && element.offsetParent !== null)
}

function focusActiveOverlay() {
  if (identityPromptOpen.value) {
    identityPrompt.value?.focus()
    return
  }

  if (predictionModalOpen.value) {
    scoreDrawer.value?.focus()
    return
  }

  if (selectedAdminEntry.value) {
    const overlay = currentOverlayElement()
    const firstFocusable = overlay ? getFocusableElements(overlay)[0] : null
    firstFocusable?.focus()
  }
}

function handleGlobalKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    if (themeMenuOpen.value) {
      event.preventDefault()
      themeMenuOpen.value = false
      clearThemePreview()
      themeTrigger.value?.focus({ preventScroll: true })
      return
    }

    if (selectedAdminEntry.value) {
      event.preventDefault()
      closeAdminEntry()
      return
    }

    if (predictionModalOpen.value) {
      event.preventDefault()
      closePredictionModal()
      return
    }

    if (identityPromptOpen.value) {
      event.preventDefault()
      closeIdentityPrompt()
    }
  }

  if (event.key !== 'Tab') return
  if (!identityPromptOpen.value && !predictionModalOpen.value && !selectedAdminEntry.value) return

  const overlay = currentOverlayElement()
  if (!overlay) return
  const focusable = getFocusableElements(overlay)
  if (!focusable.length) return
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  const active = document.activeElement as HTMLElement | null

  if (event.shiftKey && active === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && active === last) {
    event.preventDefault()
    first.focus()
  }
}

function handleRouteChange() {
  routePath.value = window.location.pathname
  if (isAdminRoute.value) {
    loading.value = false
    if (!isMobileViewportState.value) {
      void loadAdminPrizeDesk()
    }
    return
  }

  if (!isNotFound.value && !rooms.value.length) {
    void bootstrap()
  }
}

function handleResumeRealtime() {
  if (document.hidden || isNotFound.value || isAdminRoute.value) return
  void refreshActiveRoom()
}

function handleSocketEvent(event: MessageEvent<string>) {
  if (event.data === 'pong') return
  let payload: ApiEvent

  try {
    payload = JSON.parse(event.data) as ApiEvent
  } catch {
    console.warn('Ignored invalid room event payload')
    return
  }

  if (payload.type === 'bootstrap') {
    patchRoom(payload.room)
    return
  }

  if (payload.type === 'room.updated') {
    patchRoom(payload.room)
    return
  }

  if (payload.type === 'typing') {
    handleTypingEvent(payload)
  }
}

function roomPulseSignature(room: Room) {
  return JSON.stringify({
    matchStatus: room.matchStatus,
    roomStatus: room.roomStatus,
    currentScore: room.currentScore,
    mostBacked: room.mostBacked,
    predictions: room.predictions.map((prediction) => ({
      id: prediction.id,
      likes: prediction.likes,
      comments: prediction.comments.map((comment) => ({
        id: comment.id,
        text: comment.text,
        replies: comment.replies.map((reply) => ({
          id: reply.id,
          text: reply.text,
          editedAt: reply.editedAt ?? '',
        })),
      })),
    })),
  })
}

function predictionPulseSignatures(room: Room) {
  return new Map(
    room.predictions.map((prediction) => [
      prediction.id,
      JSON.stringify({
        likes: prediction.likes,
        comments: prediction.comments,
        editedAt: prediction.editedAt ?? '',
      }),
    ]),
  )
}

function markRoomUpdated(roomId: string, predictionIds: string[] = []) {
  updatedRoomIds.value = new Set([...updatedRoomIds.value, roomId])
  if (predictionIds.length) {
    updatedPredictionIds.value = new Set([...updatedPredictionIds.value, ...predictionIds])
  }

  if (livePulseTimer) window.clearTimeout(livePulseTimer)
  livePulseTimer = window.setTimeout(() => {
    updatedRoomIds.value = new Set()
    updatedPredictionIds.value = new Set()
    livePulseTimer = null
  }, 1800)
}

function connectActiveRoomEvents(roomId: string) {
  if (!roomId || isNotFound.value) return

  socketToken += 1
  const token = socketToken
  if (reconnectTimer) window.clearTimeout(reconnectTimer)

  ws.value?.close(1000, 'Switching rooms')
  realtimeStatus.value = 'connecting'

  const socket = connectRoomEvents(roomId, handleSocketEvent)
  ws.value = socket

  socket.addEventListener('open', () => {
    if (token !== socketToken) return
    reconnectAttempt = 0
    realtimeStatus.value = 'live'
  })

  socket.addEventListener('close', () => {
    if (token !== socketToken || isNotFound.value) return
    ws.value = null
    scheduleReconnect(roomId)
  })

  socket.addEventListener('error', () => {
    if (token !== socketToken) return
    realtimeStatus.value = 'reconnecting'
  })
}

function scheduleReconnect(roomId: string) {
  realtimeStatus.value = 'reconnecting'
  reconnectAttempt += 1

  void refreshRooms({ preserveActiveRoom: true, silent: true }).then((loaded) => {
    if (isNotFound.value) {
      return
    }

    if (!loaded) {
      realtimeStatus.value = 'offline'
      const delay = Math.min(8000, 900 * reconnectAttempt)
      reconnectTimer = window.setTimeout(() => {
        scheduleReconnect(roomId)
      }, delay)
      return
    }

    if (activeRoomId.value !== roomId) return

    const delay = Math.min(6000, 700 * reconnectAttempt)
    reconnectTimer = window.setTimeout(() => {
      connectActiveRoomEvents(roomId)
    }, delay)
  })
}

async function refreshRooms(options: { preserveActiveRoom?: boolean; silent?: boolean } = {}) {
  if (roomsRefreshInFlight) return false
  roomsRefreshInFlight = true
  const hadRooms = rooms.value.length > 0
  if (!options.silent && hadRooms) {
    refreshingRooms.value = true
  } else if (!options.silent) {
    loading.value = true
  }

  try {
    const response = await fetchBootstrap()
    rooms.value = response.rooms
    const currentRoomExists = response.rooms.some((room) => room.id === activeRoomId.value)
    const storedRoomId = getStoredActiveRoomId()
    const storedRoomExists = response.rooms.some((room) => room.id === storedRoomId)
    if (!options.preserveActiveRoom || !currentRoomExists) {
      activeRoomId.value = currentRoomExists
        ? activeRoomId.value
        : storedRoomExists
          ? storedRoomId
          : response.rooms.find((room) => room.isFeatured)?.id ?? response.rooms[0]?.id ?? ''
    }
    errorMessage.value = ''
    return true
  } catch (error) {
    const message = errorText(error, 'Unable to load rooms')
    if (options.silent) {
      console.warn(message)
    } else if (hadRooms) {
      showMutationError(message)
    } else {
      errorMessage.value = message
    }
    return false
  } finally {
    if (!options.silent) {
      loading.value = false
      refreshingRooms.value = false
    }
    roomsRefreshInFlight = false
  }
}

async function refreshActiveRoom() {
  const roomId = activeRoomId.value
  if (!roomId || activeRoomRefreshInFlight || isNotFound.value || isAdminRoute.value || document.hidden) return false
  activeRoomRefreshInFlight = true

  try {
    const response = await fetchRoom(roomId)
    patchRoom(response.room)
    errorMessage.value = ''
    return true
  } catch (error) {
    console.warn(errorText(error, 'Unable to refresh active room'))
    return false
  } finally {
    activeRoomRefreshInFlight = false
  }
}

async function bootstrap() {
  return refreshRooms()
}

onMounted(async () => {
  syncViewportState()
  selectedTheme.value = getStoredTheme() as ThemeId
  if (isNotFound.value) {
    loading.value = false
  } else if (isAdminRoute.value) {
    loading.value = false
    if (!isMobileViewportState.value) {
      await loadAdminPrizeDesk()
    }
  } else {
    await bootstrap()
  }
  document.addEventListener('click', handleGlobalClick)
  document.addEventListener('keydown', handleGlobalKeydown)
  window.addEventListener('popstate', handleRouteChange)
  window.addEventListener('resize', syncViewportState)
  window.addEventListener('resize', positionThemeMenu)
  window.addEventListener('resize', updateFeedNavMode)
  window.addEventListener('online', handleResumeRealtime)
  document.addEventListener('visibilitychange', handleResumeRealtime)
  window.addEventListener('scroll', positionThemeMenu, { passive: true })
  window.addEventListener('scroll', updateFeedNavMode, { passive: true })
  if (!username.value && shouldAutoPromptUsername.value) {
    identityPromptTimer = window.setTimeout(() => {
      openIdentityPrompt('Choose a username when you are ready.')
    }, 650)
  }
  roomRefreshTimer = window.setInterval(() => {
    if (isNotFound.value || isAdminRoute.value || document.hidden) return
    void refreshRooms({ preserveActiveRoom: true, silent: true })
  }, ROOM_REFRESH_MS)
  activeRoomPollTimer = window.setInterval(() => {
    void refreshActiveRoom()
  }, ACTIVE_ROOM_POLL_MS)
  topPickCarouselTimer = window.setInterval(() => {
    const count = topPickInsights.value.length
    if (count <= 1 || isNotFound.value || isAdminRoute.value || document.hidden) return
    activeTopPickIndex.value = (activeTopPickIndex.value + 1) % count
  }, TOP_PICK_SLIDE_MS)
})

onBeforeUnmount(() => {
  if (identityPromptTimer) {
    window.clearTimeout(identityPromptTimer)
  }
  if (mutationErrorTimer) {
    window.clearTimeout(mutationErrorTimer)
  }
  if (reconnectTimer) {
    window.clearTimeout(reconnectTimer)
  }
  if (activeRoomPollTimer) {
    window.clearInterval(activeRoomPollTimer)
  }
  if (roomRefreshTimer) {
    window.clearInterval(roomRefreshTimer)
  }
  if (topPickCarouselTimer) {
    window.clearInterval(topPickCarouselTimer)
  }
  if (themePreviewTimer) {
    window.clearTimeout(themePreviewTimer)
  }
  if (themeTransitionTimer) {
    window.clearTimeout(themeTransitionTimer)
    document.body.classList.remove('theme-transitioning')
  }
  if (fastCommentCollapseTimer) {
    window.clearTimeout(fastCommentCollapseTimer)
  }
  if (livePulseTimer) {
    window.clearTimeout(livePulseTimer)
  }
  clearTypingState()
  clearReplyFocusTimers()
  socketToken += 1
  ws.value?.close()
  document.removeEventListener('click', handleGlobalClick)
  document.removeEventListener('keydown', handleGlobalKeydown)
  window.removeEventListener('popstate', handleRouteChange)
  window.removeEventListener('resize', syncViewportState)
  window.removeEventListener('resize', positionThemeMenu)
  window.removeEventListener('resize', updateFeedNavMode)
  window.removeEventListener('online', handleResumeRealtime)
  document.removeEventListener('visibilitychange', handleResumeRealtime)
  window.removeEventListener('scroll', positionThemeMenu)
  window.removeEventListener('scroll', updateFeedNavMode)
})
</script>

<template>
  <main
    class="px-0 pt-0 pb-[42px] max-md:pb-[calc(96px+env(safe-area-inset-bottom))]"
    :class="isNotFound ? 'grid h-svh w-full grid-rows-[auto_minmax(0,1fr)] overflow-hidden pb-0 max-md:pb-0' : ''"
  >
    <section
      v-if="!isNotFound && !isAdminRoute"
      class="border-y border-[color:color-mix(in_srgb,var(--accent)_16%,var(--line))] bg-[color:color-mix(in_srgb,var(--accent)_4%,var(--panel))]"
      aria-label="Local profile notice"
    >
      <div class="mx-auto flex w-full max-w-[1180px] items-center justify-center gap-2 px-4 py-2 text-center text-[13px] font-[750] leading-[1.35] text-[var(--soft)] max-md:gap-1.5 max-md:px-3 max-md:py-1.5 max-md:text-[10px]">
        <span class="inline-grid h-5 w-5 shrink-0 place-items-center text-[var(--accent)] max-md:h-4 max-md:w-4" aria-hidden="true">
          <svg class="h-3.5 w-3.5 max-md:h-3 max-md:w-3" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
            <path d="M6.5 8V6.5a3.5 3.5 0 0 1 7 0V8"></path>
            <path d="M5.5 8h9v7h-9z"></path>
          </svg>
        </span>
        <p class="m-0 max-md:whitespace-nowrap">{{ bannerNoticeText }}</p>
      </div>
    </section>

    <div
      :class="isNotFound ? '' : 'mx-auto w-[min(1180px,calc(100%-32px))] pt-6 max-md:w-[min(100%,calc(100%-24px))] max-md:pt-[18px]'"
    >
    <header
      class="mb-[34px] flex items-center justify-between gap-4"
      :class="isNotFound ? 'mx-auto mb-4 w-[min(1180px,calc(100%-32px))] max-md:mb-3 max-md:w-[min(100%,calc(100%-24px))]' : ''"
    >
      <div class="min-w-0 flex items-center">
        <div class="inline-flex min-w-0 items-baseline gap-2 whitespace-nowrap text-[clamp(20px,2.2vw,30px)] leading-none font-black text-[var(--accent)] max-[380px]:text-[18px]" aria-label="Turntabl Score Room">turntabl <span class="truncate font-[750] text-[var(--text)] max-[430px]:hidden">score room</span></div>
      </div>

      <div class="flex shrink-0 items-center gap-2">
        <div
          v-if="username"
          class="inline-flex min-h-[46px] max-w-[116px] items-center gap-2 rounded-xl border border-[color:color-mix(in_srgb,var(--accent)_18%,var(--line))] bg-[color:color-mix(in_srgb,var(--chip-bg)_70%,transparent)] px-2 text-[11px] font-bold text-[var(--text)] sm:min-h-10 sm:max-w-[180px] sm:rounded-lg sm:px-2.5 sm:text-[12px]"
          aria-label="Current username"
        >
          <img class="h-6 w-6 rounded-full" :src="predictionAvatar(username)" alt="" decoding="async" />
          <span class="min-w-0 truncate">{{ username }}</span>
        </div>

      <div class="ui-select relative z-[var(--layer-dropdown)] w-[46px]" :class="{ open: themeMenuOpen }">
        <button
          ref="themeTrigger"
          class="inline-grid min-h-[46px] w-[46px] items-center justify-center rounded-xl border border-[var(--line)] bg-[var(--chip-bg)] p-0 text-[var(--text)] transition-[background-color,border-color,transform] duration-100 ease-[cubic-bezier(0.4,0,0.2,1)] hover:border-[var(--line-strong)] hover:bg-[color:color-mix(in_srgb,var(--accent)_6%,var(--chip-bg))] active:translate-y-px"
          type="button"
          aria-label="Choose theme"
          :aria-expanded="String(themeMenuOpen)"
          aria-haspopup="listbox"
          :aria-controls="themeMenuOpen ? 'theme-picker-listbox' : undefined"
          @click.stop="toggleThemeMenu"
          @keydown="handleThemeTriggerKeydown"
        >
          <svg class="ph-icon theme-icon" viewBox="0 0 256 256" aria-hidden="true" fill="none" stroke-width="16">
            <path d="M128 36C76 36 36 75.1 36 126.3 36 170 70.5 204 116.1 204h15.6c13.7 0 20.6-16.5 10.9-26.2l-5.8-5.8c-8.6-8.6-2.5-23.3 9.7-23.3h21.2c29 0 52.3-18.7 52.3-46.6C220 62.4 181.3 36 128 36Z" stroke="currentColor"></path>
            <circle class="theme-icon__paint" cx="91" cy="110" r="12"></circle>
            <circle class="theme-icon__paint theme-icon__paint--soft" cx="128" cy="83" r="12"></circle>
            <circle class="theme-icon__paint" cx="168" cy="111" r="12"></circle>
          </svg>
          <span class="sr-only">{{ selectedThemeLabel() }}</span>
        </button>

        <div
          v-if="themeMenuOpen"
          id="theme-picker-listbox"
          class="fixed left-0 top-0 z-[var(--layer-dropdown)] grid gap-0.5 overflow-auto rounded-xl border border-[var(--line-strong)] bg-[var(--panel)] p-1.5"
          :style="themeMenuStyle"
          role="listbox"
          aria-label="Theme picker"
          :aria-activedescendant="themeOptionId(highlightedThemeIndex)"
        >
          <button
            v-for="(theme, index) in mockThemes"
            :key="theme.id"
            :ref="(element) => setThemeOptionRef(element as HTMLButtonElement | null, index)"
            class="grid min-h-11 w-full grid-cols-[18px_minmax(0,1fr)] items-center gap-2.5 rounded-lg bg-transparent px-3 text-left text-[13px] font-[750] text-[var(--text)] transition-[background-color,transform] duration-100 ease-[cubic-bezier(0.4,0,0.2,1)] hover:bg-[color:color-mix(in_srgb,var(--accent)_8%,var(--panel))] active:translate-y-px aria-selected:bg-[color:color-mix(in_srgb,var(--accent)_12%,var(--panel))]"
            type="button"
            role="option"
            :id="themeOptionId(index)"
            :aria-selected="String(selectedTheme === theme.id)"
            :tabindex="index === highlightedThemeIndex ? 0 : -1"
            @mouseenter="previewTheme(theme.id)"
            @focus="previewTheme(theme.id)"
            @mouseleave="clearThemePreview"
            @blur="clearThemePreview"
            @click="applyTheme(theme.id)"
            @keydown="handleThemeOptionKeydown($event, index)"
          >
            <span class="text-[var(--accent)] font-black">{{ selectedTheme === theme.id ? '✓' : '' }}</span>
            <span>{{ theme.label }}</span>
          </button>
        </div>
      </div>
      </div>
    </header>

    <Transition name="status-toast">
      <div
        v-if="statusNotice"
        class="fixed right-4 top-4 z-[900] inline-flex min-h-10 max-w-[min(420px,calc(100%-32px))] items-center gap-2 rounded-lg border border-[color:color-mix(in_srgb,var(--accent)_20%,var(--line))] bg-[color:color-mix(in_srgb,var(--panel)_94%,var(--accent)_6%)] px-3.5 py-2 text-xs font-[720] text-[var(--text)] backdrop-blur-md max-md:left-3 max-md:right-3 max-md:top-3"
        role="status"
        aria-live="polite"
      >
        <span class="h-2 w-2 rounded-full bg-[var(--accent)]" :class="refreshingRooms || realtimeStatus === 'connecting' || realtimeStatus === 'reconnecting' ? 'animate-pulse' : ''"></span>
        <span>{{ statusNotice }}</span>
      </div>
    </Transition>

    <section
      v-if="showMobileAdminMessage"
      class="grid min-h-[60svh] place-items-center"
      aria-labelledby="mobile-admin-title"
    >
      <div class="grid max-w-[560px] gap-4 rounded-xl border border-[var(--line)] bg-[color:color-mix(in_srgb,var(--panel)_90%,transparent)] p-5 text-center shadow-[var(--card-shadow)]">
        <div class="mx-auto inline-grid h-12 w-12 place-items-center rounded-full border border-[color:color-mix(in_srgb,var(--accent)_22%,var(--line))] bg-[color:color-mix(in_srgb,var(--accent)_8%,var(--panel))] text-[var(--accent)]">
          <svg class="ph-icon h-6 w-6" viewBox="0 0 256 256" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="18">
            <rect x="40" y="56" width="176" height="120" rx="16"></rect>
            <path d="M88 200h80"></path>
            <path d="M128 176v24"></path>
          </svg>
        </div>
        <div class="grid gap-2">
          <h1 id="mobile-admin-title" class="m-0 text-[22px] font-black leading-tight text-[var(--text)]">Use a desktop for prize desk</h1>
          <p class="m-0 text-sm leading-[1.55] text-[var(--soft)]">This admin area is desktop-only for now. Open the same link on a laptop or larger screen to review winners and pickup details comfortably.</p>
        </div>
        <button
          class="mx-auto inline-flex min-h-11 items-center justify-center rounded-lg bg-[var(--accent)] px-4 text-sm font-extrabold text-[var(--accent-text)] transition-[background-color,transform] duration-100 ease-[cubic-bezier(0.4,0,0.2,1)] hover:bg-[color:color-mix(in_srgb,var(--accent)_86%,black)] active:translate-y-px"
          type="button"
          @click="showHome"
        >Back to rooms</button>
      </div>
    </section>

    <section
      v-else-if="isAdminRoute"
      class="grid gap-4"
      aria-labelledby="admin-title"
    >
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
          <p class="m-0 text-xs font-bold text-[var(--muted)]">{{ adminEntries.length }} predictions tracked</p>
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
            :disabled="adminLoading"
            @click="loadAdminPrizeDesk"
          >
            <svg class="ph-icon h-4 w-4" :class="adminLoading ? 'animate-spin' : ''" viewBox="0 0 256 256" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="18">
              <path d="M200 72v48h-48"></path>
              <path d="M56 184v-48h48"></path>
              <path d="M185.8 112A64 64 0 0 0 77 82.2L56 104"></path>
              <path d="M70.2 144A64 64 0 0 0 179 173.8L200 152"></path>
            </svg>
            <span>{{ adminLoading ? 'Refreshing' : 'Refresh desk' }}</span>
          </button>
        </div>

        <div class="rounded-lg border border-[var(--line)] bg-[color:color-mix(in_srgb,var(--chip-bg)_24%,transparent)] p-2">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <span class="px-1 text-[10px] font-extrabold uppercase tracking-[0.08em] text-[var(--muted)]">Filter predictions</span>
            <div class="flex flex-wrap items-center gap-1" aria-label="Prize desk filters">
              <button
                v-for="filter in (['all', 'winner', 'pending', 'verified', 'missing'] as AdminPrizeFilter[])"
                :key="filter"
                class="inline-flex min-h-9 items-center gap-2 rounded-lg border px-3 text-[12px] font-extrabold transition-[background-color,border-color,color] duration-100 ease-[cubic-bezier(0.4,0,0.2,1)]"
                :class="adminPrizeFilter === filter ? 'border-[color:color-mix(in_srgb,var(--accent)_46%,var(--line))] bg-[color:color-mix(in_srgb,var(--accent)_12%,var(--panel))] text-[var(--accent)] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--accent)_16%,transparent)]' : 'border-transparent bg-transparent text-[var(--soft)] hover:border-[var(--line)] hover:bg-[var(--panel)] hover:text-[var(--text)]'"
                type="button"
                @click="adminPrizeFilter = filter"
              >
                <span>{{ adminFilterLabel(filter) }}</span>
                <span class="min-w-5 rounded-md px-1.5 py-0.5 text-center text-[10px] leading-none" :class="adminPrizeFilter === filter ? 'bg-[color:color-mix(in_srgb,var(--accent)_14%,transparent)] text-[var(--accent)]' : 'bg-[color:color-mix(in_srgb,var(--text)_7%,transparent)] text-[var(--muted)]'">{{ adminFilterCount(filter) }}</span>
              </button>
            </div>
          </div>
        </div>

        <div v-if="adminLoading && !adminEntries.length" class="grid gap-2.5" aria-label="Loading prize desk">
          <div v-for="item in 3" :key="item" class="grid gap-2 rounded-lg border border-[var(--line)] bg-[color:color-mix(in_srgb,var(--chip-bg)_40%,transparent)] p-3">
            <div class="skeleton-pulse h-4 w-36 rounded-full"></div>
            <div class="grid gap-2 min-[720px]:grid-cols-3">
              <div class="skeleton-pulse h-10 rounded-lg"></div>
              <div class="skeleton-pulse h-10 rounded-lg"></div>
              <div class="skeleton-pulse h-10 rounded-lg"></div>
            </div>
          </div>
        </div>

        <div v-else-if="adminError" class="grid gap-3 rounded-lg border border-[color:color-mix(in_srgb,#d14343_28%,var(--line))] bg-[color:color-mix(in_srgb,#d14343_7%,var(--panel))] p-4 text-sm text-[var(--text)]">
          <strong class="text-[var(--danger)]">Could not load prize desk</strong>
          <p class="m-0 text-[var(--soft)]">{{ adminError }}</p>
        </div>

        <div v-else-if="!adminEntries.length" class="grid min-h-[220px] place-items-center rounded-lg border border-[var(--line)] bg-[color:color-mix(in_srgb,var(--chip-bg)_36%,transparent)] p-8 text-center">
          <div class="grid max-w-[420px] gap-2">
            <h3 class="m-0 text-lg font-black text-[var(--text)]">No predictions yet</h3>
            <p class="m-0 text-sm leading-[1.5] text-[var(--muted)]">Every submitted prediction will appear here with result status and pickup verification.</p>
          </div>
        </div>

        <div v-else-if="!adminFilteredEntries.length" class="grid min-h-[160px] place-items-center rounded-lg border border-[var(--line)] bg-[color:color-mix(in_srgb,var(--chip-bg)_30%,transparent)] p-6 text-center">
          <div class="grid gap-1">
            <h3 class="m-0 text-base font-black text-[var(--text)]">No rows for this filter</h3>
            <p class="m-0 text-sm text-[var(--muted)]">Try another filter to continue reviewing predictions.</p>
          </div>
        </div>

        <div v-else class="overflow-hidden rounded-lg border border-[var(--line)] bg-[color:color-mix(in_srgb,var(--chip-bg)_22%,transparent)]" aria-label="Prize desk predictions">
          <div class="overflow-x-auto">
            <table class="w-full min-w-[920px] border-collapse text-left text-sm">
              <thead>
                <tr class="border-b border-[var(--line)] bg-[color:color-mix(in_srgb,var(--panel)_62%,transparent)] text-[10px] font-extrabold uppercase tracking-[0.07em] text-[var(--muted)]">
                  <th class="px-3 py-2.5">User</th>
                  <th class="px-3 py-2.5">Match</th>
                  <th class="px-3 py-2.5">Prediction</th>
                  <th class="px-3 py-2.5">Actual</th>
                  <th class="px-3 py-2.5">Result</th>
                  <th class="px-3 py-2.5">Pickup</th>
                  <th class="px-3 py-2.5">Submitted</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="entry in adminPrizeVisibleEntries"
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
                    <span
                      v-if="entry.result === 'pending'"
                      class="inline-flex items-center gap-1.5 text-xs font-bold text-[var(--muted)]"
                    >
                      <span class="h-1.5 w-1.5 rounded-full bg-[color:color-mix(in_srgb,var(--muted)_58%,transparent)]" aria-hidden="true"></span>
                      Open
                    </span>
                    <span
                      v-else-if="entry.result === 'winner'"
                      class="inline-grid h-8 w-8 place-items-center rounded-full bg-[var(--accent)] text-[var(--accent-ink)] shadow-[0_8px_18px_color-mix(in_srgb,var(--accent)_20%,transparent)]"
                      :aria-label="prizeEntryStatusLabel(entry)"
                      role="img"
                    >
                      <svg class="h-4 w-4" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                        <path d="m5 10.5 3.2 3.1L15.5 6"></path>
                      </svg>
                    </span>
                    <span
                      v-else
                      class="inline-grid h-8 w-8 place-items-center rounded-full border border-[color:color-mix(in_srgb,var(--muted)_34%,var(--line))] bg-transparent text-[color:color-mix(in_srgb,var(--muted)_86%,var(--text))]"
                      :aria-label="prizeEntryStatusLabel(entry)"
                      role="img"
                    >
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
                      @click="openAdminEntry(entry)"
                    >
                      <svg class="h-4 w-4" viewBox="0 0 256 256" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="18" stroke-linecap="round" stroke-linejoin="round">
                        <path :d="adminPickupIconPath(entry)"></path>
                      </svg>
                    </button>
                    <span v-else class="text-sm font-bold text-[var(--muted)]">-</span>
                  </td>
                  <td class="px-3 py-3 align-middle text-xs font-bold text-[var(--muted)]">{{ formatAdminDate(entry.createdAt) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--line)] bg-[color:color-mix(in_srgb,var(--panel)_46%,transparent)] px-3 py-2">
            <span class="text-xs font-bold text-[var(--muted)]">{{ adminPrizeRangeLabel }}</span>
            <div class="flex items-center gap-1.5">
              <button
                class="inline-flex min-h-8 items-center rounded-lg border border-[var(--line)] bg-[var(--panel)] px-3 text-xs font-extrabold text-[var(--soft)] transition-[background-color,border-color,color] duration-100 hover:border-[var(--line-strong)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-45"
                type="button"
                :disabled="adminPrizePage === 0"
                @click="adminPrizePage = Math.max(0, adminPrizePage - 1)"
              >
                Prev
              </button>
              <span class="min-w-14 text-center text-xs font-extrabold text-[var(--muted)]">{{ adminPrizePage + 1 }}/{{ adminPrizePageCount }}</span>
              <button
                class="inline-flex min-h-8 items-center rounded-lg border border-[var(--line)] bg-[var(--panel)] px-3 text-xs font-extrabold text-[var(--soft)] transition-[background-color,border-color,color] duration-100 hover:border-[var(--line-strong)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-45"
                type="button"
                :disabled="adminPrizePage >= adminPrizePageCount - 1"
                @click="adminPrizePage = Math.min(adminPrizePageCount - 1, adminPrizePage + 1)"
              >
                Next
              </button>
            </div>
          </div>
        </div>
      </section>

      <Transition
        enter-active-class="transition-opacity duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]"
        leave-active-class="transition-opacity duration-150 ease-[cubic-bezier(0.4,0,1,1)]"
        enter-from-class="opacity-0"
        leave-to-class="opacity-0"
      >
        <div
          v-if="selectedAdminEntry"
          class="fixed inset-0 z-[1250] bg-black/35"
          role="presentation"
          @click.self="closeAdminEntry"
        >
          <Transition
            appear
            enter-active-class="transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
            leave-active-class="transition-transform duration-200 ease-[cubic-bezier(0.4,0,1,1)]"
            enter-from-class="translate-x-full"
            leave-to-class="translate-x-full"
          >
            <aside class="ml-auto flex h-full w-[min(420px,calc(100%-24px))] flex-col border-l border-[var(--line-strong)] bg-[var(--panel)] p-4 shadow-[var(--card-shadow)]" role="dialog" aria-modal="true" aria-labelledby="pickup-detail-title">
              <div class="flex items-start justify-between gap-3 border-b border-[var(--line)] pb-3">
                <div class="grid gap-1">
                  <p class="m-0 text-[10px] font-extrabold uppercase tracking-[0.08em] text-[var(--accent)]">Pickup detail</p>
                  <h3 id="pickup-detail-title" class="m-0 text-xl font-black leading-tight text-[var(--text)]">{{ selectedAdminEntry.authorName }}</h3>
                  <p class="m-0 text-xs font-bold text-[var(--muted)]">{{ selectedAdminEntry.roomTitle }}</p>
                </div>
                <button class="inline-grid h-10 w-10 place-items-center rounded-lg border border-[var(--line)] bg-[var(--chip-bg)] text-[var(--text)] hover:border-[var(--line-strong)]" type="button" aria-label="Close pickup detail" @click="closeAdminEntry">
                  <svg class="h-4 w-4" viewBox="0 0 256 256" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="18" stroke-linecap="round">
                    <path d="M72 72l112 112M184 72 72 184"></path>
                  </svg>
                </button>
              </div>

              <div class="grid gap-3 overflow-auto py-4">
                <div class="grid grid-cols-2 gap-2">
                  <div class="rounded-lg border border-[var(--line)] bg-[color:color-mix(in_srgb,var(--chip-bg)_28%,transparent)] p-3">
                    <span class="block text-[10px] font-extrabold uppercase tracking-[0.07em] text-[var(--muted)]">Prediction</span>
                    <strong class="mt-1 block text-sm text-[var(--text)]">{{ prizeEntryScore(selectedAdminEntry) }}</strong>
                  </div>
                  <div class="rounded-lg border border-[var(--line)] bg-[color:color-mix(in_srgb,var(--chip-bg)_28%,transparent)] p-3">
                    <span class="block text-[10px] font-extrabold uppercase tracking-[0.07em] text-[var(--muted)]">Actual</span>
                    <strong class="mt-1 block text-sm text-[var(--text)]">{{ prizeEntryFinalScore(selectedAdminEntry) }}</strong>
                  </div>
                </div>

                <div class="rounded-lg border border-[var(--line)] bg-[color:color-mix(in_srgb,var(--chip-bg)_22%,transparent)] p-3">
                  <span class="mb-2 inline-flex items-center gap-2 text-xs font-bold text-[var(--soft)]">
                    <span
                      v-if="selectedAdminEntry.result === 'winner'"
                      class="inline-grid h-7 w-7 place-items-center rounded-full bg-[var(--accent)] text-[var(--accent-ink)]"
                      aria-hidden="true"
                    >
                      <svg class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                        <path d="m5 10.5 3.2 3.1L15.5 6"></path>
                      </svg>
                    </span>
                    <span
                      v-else-if="selectedAdminEntry.result === 'miss'"
                      class="inline-grid h-7 w-7 place-items-center rounded-full border border-[color:color-mix(in_srgb,var(--muted)_34%,var(--line))] text-[var(--muted)]"
                      aria-hidden="true"
                    >
                      <svg class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
                        <path d="M6 6l8 8M14 6l-8 8"></path>
                      </svg>
                    </span>
                    <span
                      v-else
                      class="inline-block h-2 w-2 rounded-full bg-[color:color-mix(in_srgb,var(--muted)_58%,transparent)]"
                      aria-hidden="true"
                    ></span>
                    {{ prizeEntryStatusLabel(selectedAdminEntry) }}
                  </span>
                  <div class="grid gap-1 text-sm text-[var(--soft)]">
                    <p class="m-0"><strong class="text-[var(--text)]">Match:</strong> {{ selectedAdminEntry.home.name }} vs {{ selectedAdminEntry.away.name }}</p>
                    <p class="m-0"><strong class="text-[var(--text)]">Score provider:</strong> {{ selectedAdminEntry.finalScore?.provider || 'No score provider yet' }}</p>
                    <p class="m-0"><strong class="text-[var(--text)]">Submitted:</strong> {{ formatAdminDate(selectedAdminEntry.createdAt) }}</p>
                  </div>
                </div>

                <div class="grid gap-2 rounded-lg border border-[var(--line)] bg-[color:color-mix(in_srgb,var(--panel)_72%,transparent)] p-3">
                  <div class="flex items-center justify-between gap-2">
                    <span class="text-[10px] font-extrabold uppercase tracking-[0.07em] text-[var(--muted)]">Question and answer</span>
                    <span class="rounded-md px-2 py-1 text-[10px] font-extrabold uppercase tracking-[0.06em]" :class="selectedAdminEntry.pickup ? 'bg-[color:color-mix(in_srgb,var(--accent)_10%,transparent)] text-[var(--accent)]' : 'bg-[color:color-mix(in_srgb,var(--muted)_10%,transparent)] text-[var(--muted)]'">{{ selectedAdminEntry.pickup ? 'Provided' : 'Missing' }}</span>
                  </div>
                  <template v-if="selectedAdminEntry.pickup">
                    <div class="grid gap-1">
                      <span class="text-[11px] font-extrabold uppercase tracking-[0.06em] text-[var(--muted)]">Question</span>
                      <p class="m-0 text-sm font-bold leading-snug text-[var(--text)]">{{ selectedAdminEntry.pickup.question }}</p>
                    </div>
                    <div class="grid gap-1">
                      <span class="text-[11px] font-extrabold uppercase tracking-[0.06em] text-[var(--muted)]">Answer</span>
                      <p class="m-0 text-sm leading-snug text-[var(--soft)]">{{ selectedAdminEntry.pickup.answer }}</p>
                    </div>
                  </template>
                  <p v-else class="m-0 text-sm leading-snug text-[var(--muted)]">This prediction has no pickup question saved, so admin cannot verify prize pickup from this browser setup.</p>
                </div>
              </div>
            </aside>
          </Transition>
        </div>
      </Transition>
    </section>

    <section
      v-else-if="isNotFound"
      class="relative grid h-full min-h-0 overflow-hidden border-y border-[var(--line)] bg-[color:color-mix(in_srgb,var(--panel)_76%,transparent)] px-[clamp(22px,5vw,64px)] py-[clamp(20px,3vw,32px)] max-md:px-4 max-md:py-4"
      aria-labelledby="not-found-title"
    >
      <div class="pointer-events-none absolute inset-0 opacity-60" aria-hidden="true">
        <div class="absolute left-1/2 top-0 h-full w-px bg-[color:color-mix(in_srgb,var(--accent)_8%,transparent)]"></div>
        <div class="absolute left-1/2 top-1/2 h-[min(42vw,480px)] w-[min(42vw,480px)] -translate-x-1/2 -translate-y-1/2 rounded-full border border-[color:color-mix(in_srgb,var(--accent)_8%,transparent)]"></div>
        <div class="absolute inset-x-[clamp(24px,8vw,120px)] top-1/2 h-px bg-[color:color-mix(in_srgb,var(--accent)_7%,transparent)]"></div>
      </div>

      <div class="relative mx-auto grid h-full w-full max-w-[1180px] content-center justify-items-center gap-[clamp(22px,4vw,42px)]">
        <div class="relative overflow-hidden rounded-xl border border-[color:color-mix(in_srgb,var(--accent)_22%,var(--line))] bg-[color:color-mix(in_srgb,var(--accent)_5%,var(--panel))] p-[clamp(20px,3vw,34px)]">
          <div class="absolute inset-0 opacity-[0.42]" aria-hidden="true">
            <div class="absolute left-1/2 top-[-40%] h-[180%] w-px bg-[color:color-mix(in_srgb,var(--accent)_20%,transparent)]"></div>
            <div class="absolute left-1/2 top-1/2 h-28 w-28 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[color:color-mix(in_srgb,var(--accent)_18%,transparent)]"></div>
            <div class="absolute inset-x-8 top-1/2 h-px bg-[color:color-mix(in_srgb,var(--accent)_16%,transparent)]"></div>
          </div>

          <div class="relative grid gap-5">
            <div class="flex items-center justify-between gap-3">
              <span class="inline-flex h-8 items-center rounded-md border border-[color:color-mix(in_srgb,var(--accent)_24%,var(--line))] bg-[color:color-mix(in_srgb,var(--panel)_72%,transparent)] px-3 text-[11px] font-extrabold uppercase tracking-[0.1em] text-[var(--muted)]">Lost room</span>
              <span class="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[var(--accent)] text-xs font-black text-[var(--accent-text)]">?</span>
            </div>

            <div class="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center justify-center gap-4 text-center">
              <div class="grid justify-items-center gap-2">
                <div class="grid h-[clamp(60px,6vw,88px)] w-[clamp(60px,6vw,88px)] place-items-center rounded-full border border-[color:color-mix(in_srgb,var(--accent)_24%,var(--line))] bg-[var(--panel)] text-[clamp(30px,3vw,46px)] font-black leading-none text-[var(--accent)]">4</div>
                <span class="text-[11px] font-extrabold uppercase tracking-[0.08em] text-[var(--muted)]">Home</span>
              </div>
              <div class="inline-flex items-center gap-[clamp(8px,1.6vw,18px)] [font-variant-numeric:tabular-nums]">
                <span class="text-[clamp(76px,10vw,148px)] font-black leading-none text-[var(--text)]">4</span>
                <span class="versus text-[clamp(22px,3vw,34px)] font-semibold leading-none">v</span>
                <span class="text-[clamp(76px,10vw,148px)] font-black leading-none text-[var(--text)]">0</span>
                <span class="versus text-[clamp(22px,3vw,34px)] font-semibold leading-none">v</span>
                <span class="text-[clamp(76px,10vw,148px)] font-black leading-none text-[var(--text)]">4</span>
              </div>
              <div class="grid justify-items-center gap-2">
                <div class="grid h-[clamp(60px,6vw,88px)] w-[clamp(60px,6vw,88px)] place-items-center rounded-full border border-[color:color-mix(in_srgb,var(--accent)_24%,var(--line))] bg-[var(--panel)] text-[clamp(30px,3vw,46px)] font-black leading-none text-[var(--accent)]">4</div>
                <span class="text-[11px] font-extrabold uppercase tracking-[0.08em] text-[var(--muted)]">Away</span>
              </div>
            </div>

            <div class="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 border-t border-[color:color-mix(in_srgb,var(--accent)_18%,var(--line))] pt-4">
              <span class="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-xs font-extrabold uppercase text-[var(--muted)]">Missing link</span>
              <span class="text-xs font-extrabold uppercase text-[var(--accent)]">vs</span>
              <span class="min-w-0 overflow-hidden text-right text-ellipsis whitespace-nowrap text-xs font-extrabold uppercase text-[var(--muted)]">Real rooms</span>
            </div>
          </div>
        </div>

        <div class="grid max-w-[1120px] justify-items-center gap-5 text-center">
          <div class="grid gap-2">
            <p class="m-0 text-xs font-extrabold uppercase tracking-[0.12em] text-[var(--accent)]">404 · full time</p>
            <h1 id="not-found-title" class="m-0 text-[clamp(22px,2.4vw,30px)] font-black leading-[1.02] text-[var(--text)] min-[981px]:whitespace-nowrap">That link does not match any active Turntabl Score Room.</h1>
            <p class="m-0 mx-auto max-w-[58ch] text-[clamp(14px,1.05vw,16px)] leading-[1.55] text-[var(--soft)] min-[981px]:whitespace-nowrap">Jump back to the room list and pick a fixture that is actually on the board.</p>
          </div>

          <button
            class="inline-flex min-h-11 w-fit items-center justify-center gap-2 rounded-lg bg-[var(--accent)] px-4 text-sm font-extrabold text-[var(--accent-text)] transition-[background-color,transform] duration-100 ease-[cubic-bezier(0.4,0,0.2,1)] hover:bg-[color:color-mix(in_srgb,var(--accent)_86%,black)] active:translate-y-px"
            type="button"
            @click="showHome"
          >
            <svg class="ph-icon h-4 w-4" viewBox="0 0 256 256" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="18">
              <path d="M80 80h116"></path>
              <path d="m164 44 36 36-36 36"></path>
              <path d="M176 176H60"></path>
              <path d="m92 140-36 36 36 36"></path>
            </svg>
            <span>Back to rooms</span>
          </button>
        </div>
      </div>
    </section>

    <section v-else-if="loading" class="grid max-h-[calc(100svh-118px)] items-start gap-[18px] overflow-hidden min-[981px]:grid-cols-[minmax(0,1fr)_minmax(320px,30%)] max-md:max-h-[calc(100svh-96px)]" aria-label="Loading Turntabl Score Room">
      <div class="grid gap-[18px] max-md:gap-3">
        <div class="match-stage-sticky">
          <section class="match-stage relative overflow-hidden rounded-xl border border-[var(--line)] p-7 max-md:rounded-[10px]">
          <div class="relative z-[1] my-7 grid gap-[18px]">
            <div class="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-6 md:gap-10">
              <div class="grid justify-items-center gap-3 justify-self-end max-md:justify-self-center">
                <div class="skeleton-pulse h-[clamp(82px,21.6vw,170px)] w-[clamp(110px,21.6vw,228px)] rounded-md max-md:h-[clamp(72px,33.6vw,120px)] max-md:w-[clamp(96px,33.6vw,160px)]"></div>
                <div class="skeleton-pulse h-4 w-28 rounded-full"></div>
              </div>
              <div class="skeleton-pulse h-7 w-10 rounded-full"></div>
              <div class="grid justify-items-center gap-3 justify-self-start max-md:justify-self-center">
                <div class="skeleton-pulse h-[clamp(82px,21.6vw,170px)] w-[clamp(110px,21.6vw,228px)] rounded-md max-md:h-[clamp(72px,33.6vw,120px)] max-md:w-[clamp(96px,33.6vw,160px)]"></div>
                <div class="skeleton-pulse h-4 w-28 rounded-full"></div>
              </div>
            </div>

            <div class="grid w-full grid-cols-3 gap-0 border-t border-[var(--line)] pt-4">
              <div v-for="item in 3" :key="item" class="min-h-[58px] px-5" :class="item > 1 ? 'border-l border-[var(--line)]' : ''">
                <div class="skeleton-pulse h-10 w-16 rounded-md"></div>
                <div class="skeleton-pulse mt-3 h-3 w-20 rounded-full"></div>
              </div>
            </div>
          </div>
          <div class="skeleton-pulse mx-auto mt-1 h-4 w-[min(360px,82%)] rounded-full"></div>
          </section>
        </div>

        <section class="grid gap-[18px] max-md:gap-3" aria-label="Loading prediction feed">
          <div class="my-1 flex items-center justify-between gap-3">
            <div class="skeleton-pulse h-6 w-64 max-w-[60%] rounded-full"></div>
            <div class="skeleton-pulse h-9 w-32 rounded-lg"></div>
          </div>

          <div class="grid gap-2.5 max-md:gap-3">
            <article
              v-for="item in 2"
              :key="item"
              class="prediction relative grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3 overflow-hidden rounded-xl border border-[var(--line)] bg-[color:color-mix(in_srgb,var(--panel)_88%,transparent)] p-4 max-md:rounded-[10px] max-md:p-3.5"
            >
              <div class="skeleton-pulse h-12 w-12 rounded-full"></div>
              <div class="grid min-w-0 gap-2.5">
                <div class="flex items-center gap-2">
                  <div class="skeleton-pulse h-4 w-24 rounded-full"></div>
                  <div class="skeleton-pulse h-5 w-20 rounded-full"></div>
                </div>
                <div class="skeleton-pulse h-5 w-[min(420px,86%)] rounded-full"></div>
                <div class="grid gap-1.5 border-l border-[color:color-mix(in_srgb,var(--accent)_22%,var(--line))] pl-3">
                  <div class="skeleton-pulse h-3 w-[72%] rounded-full"></div>
                  <div class="skeleton-pulse h-3 w-[54%] rounded-full"></div>
                </div>
              </div>
              <div class="grid w-[54px] gap-2 justify-self-end">
                <div class="skeleton-pulse h-8 w-[54px] rounded-md"></div>
                <div class="skeleton-pulse h-8 w-[54px] rounded-md"></div>
              </div>
            </article>
          </div>
        </section>
      </div>

      <aside class="grid max-h-[calc(100svh-118px)] gap-3 overflow-hidden min-[981px]:sticky min-[981px]:top-4">
        <section class="overflow-hidden rounded-xl border border-[var(--line)] bg-[color:color-mix(in_srgb,var(--panel)_88%,transparent)] p-[18px] max-md:rounded-[10px]">
          <div class="grid gap-[14px] pt-[22px]">
            <div class="skeleton-pulse h-3 w-32 rounded-full"></div>
            <div class="grid grid-cols-[auto_auto_auto] items-center justify-center gap-[clamp(14px,3vw,28px)] py-3">
              <div class="skeleton-pulse h-11 w-[58px] rounded-md"></div>
              <div class="skeleton-pulse h-16 w-28 rounded-md"></div>
              <div class="skeleton-pulse h-11 w-[58px] rounded-md"></div>
            </div>
            <div class="skeleton-pulse h-11 w-full rounded-lg"></div>
          </div>
        </section>

        <section class="grid gap-[14px] rounded-xl border border-[var(--line)] bg-[color:color-mix(in_srgb,var(--panel)_88%,transparent)] p-4 max-md:rounded-[10px]">
          <div class="skeleton-pulse h-6 w-36 rounded-full"></div>
          <div class="grid gap-2.5">
            <div v-for="item in 4" :key="item" class="grid min-h-[62px] grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-t border-t-[color:color-mix(in_srgb,var(--line)_86%,transparent)] p-3 first:border-t-0 first:pt-0.5">
              <div class="skeleton-pulse h-5 w-40 rounded-full"></div>
              <div class="skeleton-pulse h-5 w-5 rounded-full"></div>
            </div>
          </div>
        </section>
      </aside>
    </section>

    <section v-else-if="errorMessage" class="relative grid min-h-[calc(100svh-126px)] overflow-hidden rounded-xl border border-[var(--line)] bg-[color:color-mix(in_srgb,var(--panel)_76%,transparent)] p-[clamp(22px,5vw,64px)] max-md:min-h-[calc(100svh-100px)] max-md:rounded-[10px] max-md:p-4">
      <div class="pointer-events-none absolute inset-0 opacity-60" aria-hidden="true">
        <div class="absolute left-1/2 top-0 h-full w-px bg-[color:color-mix(in_srgb,var(--accent)_8%,transparent)]"></div>
        <div class="absolute left-1/2 top-1/2 h-[min(42vw,480px)] w-[min(42vw,480px)] -translate-x-1/2 -translate-y-1/2 rounded-full border border-[color:color-mix(in_srgb,var(--accent)_8%,transparent)]"></div>
        <div class="absolute inset-x-[clamp(24px,8vw,120px)] top-1/2 h-px bg-[color:color-mix(in_srgb,var(--accent)_7%,transparent)]"></div>
      </div>

      <div class="relative mx-auto grid h-full w-full max-w-[1040px] content-center justify-items-center gap-[clamp(22px,4vw,42px)]">
        <div class="relative overflow-hidden rounded-xl border border-[color:color-mix(in_srgb,var(--accent)_22%,var(--line))] bg-[color:color-mix(in_srgb,var(--accent)_5%,var(--panel))] p-[clamp(20px,3vw,34px)]">
          <div class="absolute inset-0 opacity-[0.42]" aria-hidden="true">
            <div class="absolute left-1/2 top-[-40%] h-[180%] w-px bg-[color:color-mix(in_srgb,var(--accent)_20%,transparent)]"></div>
            <div class="absolute left-1/2 top-1/2 h-28 w-28 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[color:color-mix(in_srgb,var(--accent)_18%,transparent)]"></div>
            <div class="absolute inset-x-8 top-1/2 h-px bg-[color:color-mix(in_srgb,var(--accent)_16%,transparent)]"></div>
          </div>

          <div class="relative grid gap-5">
            <div class="flex items-center justify-between gap-3">
              <span class="inline-flex h-8 items-center rounded-md border border-[color:color-mix(in_srgb,var(--accent)_24%,var(--line))] bg-[color:color-mix(in_srgb,var(--panel)_72%,transparent)] px-3 text-[11px] font-extrabold uppercase tracking-[0.1em] text-[var(--muted)]">Board check</span>
              <span class="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[var(--accent)] text-xs font-black text-[var(--accent-text)]">!</span>
            </div>

            <div class="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center justify-center gap-4 text-center">
              <div class="grid justify-items-center gap-2">
                <div class="grid h-[clamp(60px,6vw,88px)] w-[clamp(60px,6vw,88px)] place-items-center rounded-full border border-[color:color-mix(in_srgb,var(--accent)_24%,var(--line))] bg-[var(--panel)] text-[clamp(30px,3vw,46px)] font-black leading-none text-[var(--accent)]">?</div>
                <span class="text-[11px] font-extrabold uppercase tracking-[0.08em] text-[var(--muted)]">Rooms</span>
              </div>
              <div class="inline-flex items-center gap-[clamp(8px,1.6vw,18px)] [font-variant-numeric:tabular-nums]">
                <span class="text-[clamp(76px,10vw,148px)] font-black leading-none text-[var(--text)]">0</span>
                <span class="versus text-[clamp(22px,3vw,34px)] font-semibold leading-none">v</span>
                <span class="text-[clamp(76px,10vw,148px)] font-black leading-none text-[var(--text)]">0</span>
              </div>
              <div class="grid justify-items-center gap-2">
                <div class="grid h-[clamp(60px,6vw,88px)] w-[clamp(60px,6vw,88px)] place-items-center rounded-full border border-[color:color-mix(in_srgb,var(--accent)_24%,var(--line))] bg-[var(--panel)] text-[clamp(30px,3vw,46px)] font-black leading-none text-[var(--accent)]">?</div>
                <span class="text-[11px] font-extrabold uppercase tracking-[0.08em] text-[var(--muted)]">Board</span>
              </div>
            </div>

            <div class="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 border-t border-[color:color-mix(in_srgb,var(--accent)_18%,var(--line))] pt-4">
              <span class="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-xs font-extrabold uppercase text-[var(--muted)]">Loading</span>
              <span class="text-xs font-extrabold uppercase text-[var(--accent)]">vs</span>
              <span class="min-w-0 overflow-hidden text-right text-ellipsis whitespace-nowrap text-xs font-extrabold uppercase text-[var(--muted)]">Latest rooms</span>
            </div>
          </div>
        </div>

        <div class="grid max-w-[760px] justify-items-center gap-5 text-center">
          <div class="grid gap-2">
            <p class="m-0 text-xs font-extrabold uppercase tracking-[0.12em] text-[var(--accent)]">Board check</p>
            <h1 class="m-0 text-[clamp(48px,7vw,96px)] font-black leading-[0.92] text-[var(--text)]">Room board needs a refresh</h1>
            <p class="m-0 mx-auto max-w-[52ch] text-[clamp(15px,1.35vw,18px)] leading-[1.55] text-[var(--soft)]">{{ roomLoadReason() }}</p>
          </div>

          <div class="grid max-w-[560px] gap-2 rounded-lg border border-[color:color-mix(in_srgb,var(--accent)_16%,var(--line))] bg-[color:color-mix(in_srgb,var(--chip-bg)_48%,transparent)] p-4 text-center">
            <div class="text-[11px] font-extrabold uppercase tracking-[0.08em] text-[var(--muted)]">Current status</div>
            <p class="m-0 text-sm leading-[1.55] text-[var(--soft)]">{{ roomLoadRecoveryHint() }}</p>
          </div>

          <button
            class="inline-flex min-h-11 w-fit items-center justify-center gap-2 rounded-lg bg-[var(--accent)] px-4 text-sm font-extrabold text-[var(--accent-text)] transition-[background-color,opacity,transform] duration-100 ease-[cubic-bezier(0.4,0,0.2,1)] hover:bg-[color:color-mix(in_srgb,var(--accent)_86%,black)] active:translate-y-px disabled:cursor-wait disabled:opacity-75 disabled:active:translate-y-0"
            type="button"
            :disabled="loading || refreshingRooms"
            @click="bootstrap"
          >
            <svg v-if="loading || refreshingRooms" class="h-4 w-4 animate-spin" viewBox="0 0 24 24" aria-hidden="true" fill="none">
              <circle class="opacity-30" cx="12" cy="12" r="9" stroke="currentColor" stroke-width="3"></circle>
              <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" stroke-linecap="round" stroke-width="3"></path>
            </svg>
            <svg v-else class="ph-icon h-4 w-4" viewBox="0 0 256 256" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="18">
              <path d="M200 72v48h-48"></path>
              <path d="M56 184v-48h48"></path>
              <path d="M185.8 112A64 64 0 0 0 77 82.2L56 104"></path>
              <path d="M70.2 144A64 64 0 0 0 179 173.8L200 152"></path>
            </svg>
            <span>{{ loading || refreshingRooms ? 'Retrying...' : 'Refresh room board' }}</span>
          </button>
        </div>
      </div>
    </section>
    <section v-else-if="!rooms.length" class="grid min-h-[420px] place-items-center rounded-xl border border-[var(--line)] bg-[color:color-mix(in_srgb,var(--panel)_88%,transparent)] p-8 text-center">
      <div class="grid max-w-[480px] justify-items-center gap-3">
        <div class="inline-grid h-14 w-14 place-items-center rounded-full border border-[color:color-mix(in_srgb,var(--accent)_18%,var(--line))] bg-[color:color-mix(in_srgb,var(--accent)_7%,var(--panel))] text-[var(--accent)]">
          <svg class="ph-icon h-7 w-7" viewBox="0 0 256 256" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="18">
            <path d="M40 84h176"></path>
            <path d="M64 132h128"></path>
            <path d="M92 180h72"></path>
          </svg>
        </div>
        <h1 class="m-0 text-3xl font-black leading-tight text-[var(--text)]">No rooms yet</h1>
        <p class="m-0 text-sm leading-[1.55] text-[var(--muted)]">There are no fixtures in this cycle right now. Refresh when the next room slate is ready.</p>
        <button
          class="mt-2 inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-[color:color-mix(in_srgb,var(--accent)_28%,var(--line))] bg-[color:color-mix(in_srgb,var(--accent)_7%,var(--panel))] px-4 text-sm font-extrabold text-[var(--accent)] transition-[background-color,opacity,transform] duration-100 ease-[cubic-bezier(0.4,0,0.2,1)] hover:bg-[color:color-mix(in_srgb,var(--accent)_11%,var(--panel))] active:translate-y-px disabled:cursor-wait disabled:opacity-70 disabled:active:translate-y-0"
          type="button"
          :disabled="refreshingRooms"
          @click="bootstrap"
        >
          <svg class="ph-icon h-4 w-4" :class="refreshingRooms ? 'animate-spin' : ''" viewBox="0 0 256 256" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="18">
            <path d="M200 72v48h-48"></path>
            <path d="M56 184v-48h48"></path>
            <path d="M185.8 112A64 64 0 0 0 77 82.2L56 104"></path>
            <path d="M70.2 144A64 64 0 0 0 179 173.8L200 152"></path>
          </svg>
          <span>{{ refreshingRooms ? 'Checking...' : 'Refresh rooms' }}</span>
        </button>
      </div>
    </section>
    <section
      v-else-if="activeRoom"
      class="grid items-start gap-[18px] min-[981px]:grid-cols-[minmax(0,1fr)_minmax(320px,30%)]"
      :class="roomSwitchDirection === 'forward' ? 'room-switch-forward' : 'room-switch-backward'"
    >
      <div class="grid gap-[18px] max-md:gap-3">
        <button
          v-if="sortedPredictions.length"
          class="hidden items-center justify-center gap-2 transition-[background-color,border-color,color,transform] duration-150 ease-[var(--ease)] active:translate-y-px disabled:cursor-default disabled:active:translate-y-0 max-md:inline-flex"
          :class="scoreCtaDisabled
            ? 'mx-auto min-h-9 w-fit rounded-full border border-[color:color-mix(in_srgb,var(--accent)_26%,var(--line))] bg-[color:color-mix(in_srgb,var(--panel)_82%,var(--accent)_8%)] px-3.5 text-[11px] font-black uppercase text-[color:color-mix(in_srgb,var(--accent)_82%,var(--text))] shadow-none'
            : 'min-h-12 w-full rounded-xl bg-[var(--accent)] px-4 text-[15px] font-extrabold text-[var(--accent-text)]'"
          type="button"
          :disabled="scoreCtaDisabled"
          @click="openPredictionModal"
        >
          <svg v-if="scoreCtaDisabled" class="ph-icon h-3.5 w-3.5" viewBox="0 0 256 256" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="24">
            <path d="m40 132 58 58L216 72"></path>
          </svg>
          <span>{{ scoreCtaLabel }}</span>
        </button>

        <div class="match-stage-sticky">
          <section
            class="match-stage relative overflow-hidden rounded-xl border border-[var(--line)] p-7 max-md:min-h-0 max-md:rounded-[10px] max-md:border-transparent max-md:p-4"
            :class="isRoomRecentlyUpdated(activeRoom.id) ? 'room-update-pulse' : ''"
          >
            <Transition name="room-surface" mode="out-in">
              <div :key="`hero-${activeRoom.id}`" class="relative z-[1] my-7 grid gap-[18px] max-md:my-3 max-md:gap-3">
                <h1 class="grid max-w-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-6 text-center max-md:gap-2 md:gap-10">
                  <span class="grid min-w-0 justify-self-end justify-items-center gap-3 max-md:justify-self-center max-md:gap-2">
                    <span
                      v-if="hasSpriteFlag(activeRoom.home)"
                      class="title-flag !block aspect-[4/3] !w-[clamp(208px,21.6vw,304px)] max-w-full overflow-hidden rounded-[6px] border-0 shadow-none max-md:!w-[clamp(74px,25vw,104px)]"
                      :class="flagClass(activeRoom.home)"
                      :aria-label="`${activeRoom.home.name} flag`"
                    ></span>
                    <span
                      v-else
                      class="title-flag flag-fallback !block aspect-[4/3] !w-[clamp(208px,21.6vw,304px)] max-w-full overflow-hidden rounded-[6px] border-0 shadow-none max-md:!w-[clamp(74px,25vw,104px)]"
                      :aria-label="`${activeRoom.home.name} flag`"
                    >{{ activeRoom.home.flag || activeRoom.home.code }}</span>
                    <span class="max-w-[20ch] text-center text-[clamp(14px,1.28vw,18px)] font-medium leading-[1.08] text-[var(--soft)] max-md:max-w-[12ch] max-md:overflow-hidden max-md:text-ellipsis max-md:whitespace-nowrap max-md:text-xs" :title="activeRoom.home.name">{{ activeRoom.home.name }}</span>
                  </span>
                  <span class="versus self-center text-[clamp(20px,2.6vw,32px)] font-semibold leading-none text-[var(--accent)] max-md:text-[clamp(18px,5vw,24px)]">vs</span>
                  <span class="grid min-w-0 justify-self-start justify-items-center gap-3 max-md:justify-self-center max-md:gap-2">
                    <span
                      v-if="hasSpriteFlag(activeRoom.away)"
                      class="title-flag !block aspect-[4/3] !w-[clamp(208px,21.6vw,304px)] max-w-full overflow-hidden rounded-[6px] border-0 shadow-none max-md:!w-[clamp(74px,25vw,104px)]"
                      :class="flagClass(activeRoom.away)"
                      :aria-label="`${activeRoom.away.name} flag`"
                    ></span>
                    <span
                      v-else
                      class="title-flag flag-fallback !block aspect-[4/3] !w-[clamp(208px,21.6vw,304px)] max-w-full overflow-hidden rounded-[6px] border-0 shadow-none max-md:!w-[clamp(74px,25vw,104px)]"
                      :aria-label="`${activeRoom.away.name} flag`"
                    >{{ activeRoom.away.flag || activeRoom.away.code }}</span>
                    <span class="max-w-[20ch] text-center text-[clamp(14px,1.28vw,18px)] font-medium leading-[1.08] text-[var(--soft)] max-md:max-w-[12ch] max-md:overflow-hidden max-md:text-ellipsis max-md:whitespace-nowrap max-md:text-xs" :title="activeRoom.away.name">{{ activeRoom.away.name }}</span>
                  </span>
                </h1>

                <div
                  v-if="activeRoomFinalScore"
                  class="mt-0.5 grid gap-3 border-t border-[var(--line)] pt-4 text-center max-md:gap-2 max-md:pt-3"
                  aria-label="Exact score picks"
                >
                  <div class="flex flex-wrap items-center justify-center gap-2 text-[13px] font-extrabold uppercase tracking-[0.08em] text-[var(--muted)] max-md:text-[10px]">
                    <span>Final score</span>
                    <span class="rounded-md border border-[color:color-mix(in_srgb,var(--accent)_22%,var(--line))] bg-[color:color-mix(in_srgb,var(--accent)_7%,var(--panel))] px-2 py-1 text-[var(--text)] [font-variant-numeric:tabular-nums]">
                      {{ activeRoom.home.code }} {{ activeRoomFinalScore.home }}-{{ activeRoomFinalScore.away }} {{ activeRoom.away.code }}
                    </span>
                  </div>

                  <div v-if="exactPickPredictions.length > 0" class="grid justify-items-center gap-1.5">
                    <strong class="block text-[clamp(28px,3vw,44px)] leading-none text-[var(--text)] max-md:text-[24px]">{{ exactPickPredictions.length }}</strong>
                    <span class="text-[13px] font-[750] text-[var(--muted)] max-md:text-[11px]">
                      {{ exactPickPredictions.length === 1 ? 'exact pick' : 'exact picks' }}
                    </span>
                    <span v-if="exactPickPreview" class="max-w-full truncate text-[14px] font-[750] text-[color:color-mix(in_srgb,var(--accent)_70%,var(--text))] max-md:text-[12px]">
                      {{ exactPickPreview }}
                    </span>
                  </div>
                </div>

                <div v-else class="mt-0.5 grid w-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-0 border-t border-[var(--line)] pt-4 max-md:pt-3" aria-label="Event stats">
                  <div class="grid min-h-[58px] justify-items-center px-4 text-center max-md:min-h-[46px] max-md:px-2">
                    <strong class="block text-[clamp(30px,3vw,44px)] leading-[0.95] text-[var(--text)] max-md:text-[26px]">{{ activeRoom.predictions.length }}</strong>
                    <span class="mt-2 block text-[13px] font-[650] text-[var(--muted)] max-md:mt-1 max-md:text-[11px]">Predictions</span>
                  </div>
                  <span class="h-1.5 w-1.5 self-center rounded-full bg-[color:color-mix(in_srgb,var(--muted)_38%,transparent)]" aria-hidden="true"></span>
                  <div class="grid min-h-[58px] justify-items-center px-4 text-center max-md:min-h-[46px] max-md:px-2">
                    <strong class="block text-[clamp(30px,3vw,44px)] leading-[0.95] text-[var(--text)] max-md:text-[26px]">{{ totalLikes }}</strong>
                    <span class="mt-2 block text-[13px] font-[650] text-[var(--muted)] max-md:mt-1 max-md:text-[11px]">Likes</span>
                  </div>
                  <span class="h-1.5 w-1.5 self-center rounded-full bg-[color:color-mix(in_srgb,var(--muted)_38%,transparent)]" aria-hidden="true"></span>
                  <div class="grid min-h-[58px] justify-items-center px-4 text-center max-md:min-h-[46px] max-md:px-2">
                    <strong class="block text-[clamp(30px,3vw,44px)] leading-[0.95] text-[var(--text)] max-md:text-[26px]">{{ totalComments }}</strong>
                    <span class="mt-2 block text-[13px] font-[650] text-[var(--muted)] max-md:mt-1 max-md:text-[11px]">Replies</span>
                  </div>
                </div>
              </div>
            </Transition>

            <p
              v-if="!activeRoomPredictionsClosed"
              class="mt-1 text-center text-[15px] leading-[1.45] font-medium text-[var(--muted)] max-md:hidden"
            >
              Drop your score and let the room react.
            </p>
          </section>
        </div>

        <section
          class="top-pick-shell-mobile hidden min-h-11 items-center justify-between gap-3 rounded-[10px] border bg-[color:color-mix(in_srgb,var(--panel)_68%,transparent)] px-3.5 py-2.5 text-left max-md:flex max-md:border-transparent"
          :class="[
            activeRoom.predictions.length ? 'border-[color:color-mix(in_srgb,var(--accent)_20%,var(--line))]' : 'border-dashed border-[color:color-mix(in_srgb,var(--muted)_34%,var(--line))]',
            isRoomRecentlyUpdated(activeRoom.id) ? 'room-update-pulse' : '',
          ]"
          :aria-label="activeRoom.predictions.length ? `Top pick: ${activeRoom.home.code} ${activeRoom.mostBacked.home}, ${activeRoom.away.code} ${activeRoom.mostBacked.away}` : 'No top pick yet'"
        >
          <Transition name="room-surface" mode="out-in">
            <div
              :key="`mobile-top-pick-${activeRoom.id}`"
              class="top-pick-carousel min-h-[52px] w-full"
              :style="{ '--slide-count': topPickInsights.length }"
            >
              <Transition name="top-pick-fade" mode="out-in">
                <div
                  v-if="activeTopPickInsight"
                  :key="`mobile-readout-${activeRoom.id}-${activeTopPickInsight.key}`"
                  class="top-pick-slide grid w-full content-center gap-1"
                  :class="`top-pick-slide-${activeTopPickInsight.tone}`"
                >
                  <span class="inline-flex min-w-0 items-center gap-1.5 whitespace-nowrap">
                    <span class="top-pick-emoji text-base leading-none" aria-hidden="true">{{ activeTopPickInsight.icon }}</span>
                    <span class="text-[10px] font-black uppercase leading-none tracking-[0.08em]" :class="activeRoom.predictions.length ? 'text-[color:color-mix(in_srgb,var(--accent)_82%,var(--text))]' : 'text-[var(--muted)]'">{{ activeTopPickInsight.label }}</span>
                    <span class="text-[var(--muted)]">·</span>
                    <span class="truncate text-[12px] font-[650] leading-tight text-[var(--muted)]">{{ activeTopPickInsight.caption }}</span>
                  </span>

                  <span class="truncate text-[15px] font-black leading-tight text-[var(--text)]">
                    {{ activeTopPickInsight.value }}
                  </span>
                </div>
              </Transition>
              <div v-if="topPickInsights.length > 1" class="top-pick-dots absolute bottom-0 right-0 flex items-center gap-1.5" aria-hidden="true">
                <span
                  v-for="(_, index) in topPickInsights"
                  :key="`mobile-dot-${index}`"
                  class="top-pick-dot"
                  :class="{ 'top-pick-dot-active': index === activeTopPickIndex % topPickInsights.length }"
                ></span>
              </div>
            </div>
          </Transition>
        </section>

        <section class="grid gap-2 rounded-[10px] border border-[var(--line)] bg-[color:color-mix(in_srgb,var(--panel)_88%,transparent)] p-3 md:hidden max-md:border-transparent" aria-label="Mobile chat rooms">
          <div class="flex items-center justify-between gap-3">
            <div class="flex items-center gap-2">
              <svg class="ph-icon h-4 w-4 text-[var(--muted)]" viewBox="0 0 256 256" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="18">
                <path d="M84 176H48a16 16 0 0 1-16-16V64a16 16 0 0 1 16-16h160a16 16 0 0 1 16 16v96a16 16 0 0 1-16 16h-72l-40 32Z"></path>
                <path d="M84 96h88"></path>
                <path d="M84 128h56"></path>
              </svg>
              <h2 class="m-0 text-base font-[760] leading-tight text-[var(--text)]">Chat rooms</h2>
            </div>
            <div v-if="roomDayBuckets.length > 1" class="flex items-center justify-between gap-2 text-[var(--muted)]" aria-label="Room pages">
                <button
                  class="inline-grid h-7 w-7 place-items-center rounded-md border border-transparent text-[var(--muted)] transition-[background-color,border-color,color,transform] duration-100 ease-[cubic-bezier(0.4,0,0.2,1)] hover:bg-[color:color-mix(in_srgb,var(--chip-bg)_72%,transparent)] hover:text-[var(--accent)] active:translate-y-px disabled:pointer-events-none disabled:opacity-25"
                  type="button"
                  aria-label="Previous rooms"
                  :disabled="!leftRoomBucket"
                  @click="previousRoomPage"
                >
                  <svg class="ph-icon h-3.5 w-3.5" viewBox="0 0 256 256" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="22">
                    <path d="M160 48 80 128l80 80"></path>
                  </svg>
                </button>
                <span class="text-[11px] font-bold text-[var(--muted)]">{{ roomPageLabel }}</span>
                <button
                  class="inline-grid h-7 w-7 place-items-center rounded-md border border-transparent text-[var(--muted)] transition-[background-color,border-color,color,transform] duration-100 ease-[cubic-bezier(0.4,0,0.2,1)] hover:bg-[color:color-mix(in_srgb,var(--chip-bg)_72%,transparent)] hover:text-[var(--accent)] active:translate-y-px disabled:pointer-events-none disabled:opacity-25"
                  type="button"
                  aria-label="Next rooms"
                  :disabled="!rightRoomBucket"
                  @click="nextRoomPage"
                >
                  <svg class="ph-icon h-3.5 w-3.5" viewBox="0 0 256 256" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="22">
                    <path d="m96 48 80 80-80 80"></path>
                  </svg>
                </button>
            </div>
            <span v-else class="text-[11px] font-bold text-[var(--muted)]">{{ rooms.length }} rooms</span>
          </div>

          <div class="grid grid-cols-2 gap-2" aria-label="Match rooms for the current cycle">
            <button
              v-for="room in visibleRooms"
              :key="room.id"
              class="grid min-h-[82px] grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-lg border p-2 text-left transition-[background-color,border-color,transform] duration-150 ease-[var(--ease)] active:translate-y-px"
              :class="[
                room.id === activeRoomId ? 'border-[color:color-mix(in_srgb,var(--accent)_34%,var(--line))] bg-[color:color-mix(in_srgb,var(--accent)_6%,var(--panel))]' : 'border-[var(--line)] bg-[color:color-mix(in_srgb,var(--chip-bg)_46%,transparent)]',
                effectiveRoomMatchStatus(room) === 'finished' ? 'opacity-80' : '',
                isRoomRecentlyUpdated(room.id) ? 'room-update-pulse' : '',
              ]"
              type="button"
              @click="setActiveRoom(room.id)"
            >
              <span class="grid min-w-0 content-center gap-1 self-center">
                <span class="grid min-w-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-1.5">
                  <span class="grid min-w-0 justify-items-center gap-1">
                    <span v-if="hasSpriteFlag(room.home)" :class="['mobile-room-flag', flagClass(room.home)]" :aria-label="`${room.home.name} flag`"></span>
                    <span v-else class="mobile-room-flag flag-fallback flag-fallback-inline" :aria-label="`${room.home.name} flag`">{{ room.home.flag || room.home.code }}</span>
                    <span class="text-[10px] font-black uppercase leading-none text-[var(--text)]">{{ room.home.code }}</span>
                  </span>
                  <span class="ref-versus mt-1.5 justify-self-center text-[12px] leading-none">v</span>
                  <span class="grid min-w-0 justify-items-center gap-1">
                    <span v-if="hasSpriteFlag(room.away)" :class="['mobile-room-flag', flagClass(room.away)]" :aria-label="`${room.away.name} flag`"></span>
                    <span v-else class="mobile-room-flag flag-fallback flag-fallback-inline" :aria-label="`${room.away.name} flag`">{{ room.away.flag || room.away.code }}</span>
                    <span class="text-[10px] font-black uppercase leading-none text-[var(--text)]">{{ room.away.code }}</span>
                  </span>
                </span>
              </span>

              <span
                class="grid min-w-[36px] content-center justify-items-center gap-1 justify-self-end self-center px-0.5 text-[color:color-mix(in_srgb,var(--accent)_72%,var(--text))]"
                :aria-label="roomStatusLabel(room)"
              >
                <span v-if="showsLiveRoomIcon(room)" class="grid justify-items-center gap-1">
                  <span class="text-[10px] font-black uppercase leading-none text-[var(--accent)]">{{ mobileRoomStatusText(room) }}</span>
                  <span class="live-pulse-dot h-2 w-2 rounded-full bg-current" aria-hidden="true"></span>
                </span>
                <span v-else-if="effectiveRoomMatchStatus(room) === 'finished' || room.roomStatus === 'closed'" class="grid justify-items-center gap-1 text-[var(--muted)]">
                  <span class="text-[10px] font-black uppercase leading-none">{{ mobileRoomStatusText(room) }}</span>
                  <svg class="ph-icon h-3.5 w-3.5" viewBox="0 0 256 256" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="18">
                    <rect x="48" y="108" width="160" height="104" rx="16"></rect>
                    <path d="M88 108V76a40 40 0 0 1 80 0v32"></path>
                  </svg>
                </span>
                <span v-else class="grid justify-items-center gap-1">
                  <span class="text-[10px] font-black uppercase leading-none">{{ mobileRoomStatusText(room) }}</span>
                  <svg class="ph-icon h-3.5 w-3.5" viewBox="0 0 256 256" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="18">
                    <circle cx="128" cy="128" r="84"></circle>
                    <path d="M128 76v56l38 22"></path>
                  </svg>
                </span>
              </span>
            </button>
          </div>
        </section>

        <section ref="predictionFeed" class="grid gap-[18px] max-md:gap-3" aria-label="Prediction feed">
          <div class="my-1 flex items-baseline justify-between gap-3 max-sm:flex-nowrap max-sm:gap-2">
            <h2 class="m-0 min-w-0 text-[18px] font-[760] leading-tight text-[var(--text)] max-sm:flex-1 max-sm:whitespace-nowrap max-sm:text-[13px]">
              Prediction feed
              <span class="mx-1.5 text-[var(--muted)] max-sm:mx-1">·</span>
              <span class="text-[15px] font-medium text-[var(--muted)] max-sm:text-[11px]">Sorted by room energy</span>
            </h2>
            <button
              class="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg border border-[color:color-mix(in_srgb,var(--line)_78%,transparent)] bg-[color:color-mix(in_srgb,var(--chip-bg)_84%,transparent)] px-3 text-[13px] font-[760] text-[var(--soft)] transition-[background-color,border-color,color,opacity,transform] duration-150 ease-[var(--ease)] hover:border-[color:color-mix(in_srgb,var(--accent)_24%,var(--line))] hover:bg-[color:color-mix(in_srgb,var(--accent)_6%,var(--chip-bg))] hover:text-[var(--text)] active:translate-y-px disabled:cursor-not-allowed disabled:border-[var(--line)] disabled:bg-[color:color-mix(in_srgb,var(--chip-bg)_44%,transparent)] disabled:text-[var(--muted)] disabled:opacity-50 disabled:shadow-none disabled:hover:bg-[color:color-mix(in_srgb,var(--chip-bg)_44%,transparent)] disabled:active:translate-y-0 max-sm:ml-auto max-sm:h-8 max-sm:min-h-8 max-sm:w-[66px] max-sm:gap-1 max-sm:self-baseline max-sm:rounded-md max-sm:border-[var(--line)] max-sm:bg-[color:color-mix(in_srgb,var(--chip-bg)_72%,transparent)] max-sm:px-2 max-sm:py-0 max-sm:text-[11px] max-sm:font-[780] max-sm:leading-none max-sm:text-[var(--soft)] md:min-h-9"
              type="button"
              :aria-label="nextFeedSortLabel"
              :aria-pressed="feedSortMode === 'comments'"
              :disabled="!canSortPredictions"
              @click="toggleFeedSort"
            >
              <svg class="ph-icon h-4 w-4 max-sm:h-2.5 max-sm:w-2.5" :class="canSortPredictions ? 'text-[var(--accent)]' : 'text-[var(--muted)]'" viewBox="0 0 256 256" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="18">
                <path d="M40 72h88"></path>
                <path d="M168 72h48"></path>
                <path d="M144 48v48"></path>
                <path d="M40 128h40"></path>
                <path d="M120 128h96"></path>
                <path d="M96 104v48"></path>
                <path d="M40 184h120"></path>
                <path d="M200 184h16"></path>
                <path d="M176 160v48"></path>
              </svg>
              <Transition name="sort-label" mode="out-in">
                <span :key="feedSortMode" class="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
                  <span class="hidden sm:inline">{{ feedSortLabel }}</span>
                  <span class="sm:hidden">{{ mobileFeedSortLabel }}</span>
                </span>
              </Transition>
            </button>
          </div>

          <Transition name="room-feed" mode="out-in">
          <div
            v-if="!sortedPredictions.length"
            :key="`feed-empty-${activeRoom.id}`"
            class="grid justify-items-center gap-3 rounded-xl border border-[var(--line)] bg-[color:color-mix(in_srgb,var(--panel)_88%,transparent)] p-5 text-center max-md:rounded-[10px] max-md:p-4"
          >
            <div class="inline-grid h-12 w-12 place-items-center rounded-full border border-[color:color-mix(in_srgb,var(--accent)_18%,var(--line))] bg-[color:color-mix(in_srgb,var(--accent)_7%,var(--panel))] text-[var(--accent)]">
              <svg class="ph-icon h-6 w-6" viewBox="0 0 256 256" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="18">
                <path d="M56 184h144"></path>
                <path d="M72 136h112"></path>
                <path d="M96 88h64"></path>
              </svg>
            </div>
            <div class="grid gap-1">
              <h3 class="m-0 text-lg font-black leading-tight text-[var(--text)]">No predictions yet</h3>
              <p class="m-0 max-w-[38ch] text-sm leading-[1.5] text-[var(--muted)]">Be first in the room with a score people can argue with.</p>
            </div>
            <button
              class="inline-flex min-h-11 items-center justify-center rounded-lg bg-[var(--accent)] px-4 text-sm font-extrabold text-[var(--accent-text)] transition-[background-color,opacity,transform] duration-100 ease-[cubic-bezier(0.4,0,0.2,1)] hover:bg-[color:color-mix(in_srgb,var(--accent)_86%,black)] active:translate-y-px disabled:cursor-default disabled:bg-[color:color-mix(in_srgb,var(--accent)_18%,var(--chip-bg))] disabled:text-[color:color-mix(in_srgb,var(--accent)_72%,var(--text))] disabled:opacity-80 disabled:active:translate-y-0"
              type="button"
              :disabled="scoreCtaDisabled"
              @click="openPredictionModal"
            >
              {{ scoreCtaLabel }}
            </button>
          </div>

            <div v-else :key="`feed-list-${activeRoom.id}`" ref="predictionFeedList">
            <TransitionGroup :key="activeRoom.id" name="prediction-list" tag="div" class="grid gap-2.5 max-md:gap-3">
              <article
                v-for="item in sortedPredictions"
                :key="item.id"
                data-prediction-card
                class="prediction relative grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3 overflow-hidden rounded-xl border border-[var(--line)] bg-[color:color-mix(in_srgb,var(--panel)_88%,transparent)] p-4 transition-[background-color,border-color] duration-300 ease-[var(--ease)] max-md:grid-cols-[40px_minmax(0,1fr)_38px] max-md:gap-2.5 max-md:rounded-[10px] max-md:p-3"
                :class="[
                  isReplying(item.id, replyTargetIdForPrediction(item)) || isCommentsExpanded(item.id) ? 'border-[color:color-mix(in_srgb,var(--accent)_30%,var(--line))] bg-[color:color-mix(in_srgb,var(--accent)_4%,var(--panel))]' : '',
                  isPredictionRecentlyUpdated(item.id) ? 'room-update-pulse' : '',
                  isOptimisticPrediction(item.id) ? 'opacity-80' : '',
                ]"
              >
              <div class="pt-0.5 max-md:pt-0">
                <div class="prediction-avatar-wrap">
                  <img class="prediction-avatar" :src="predictionAvatar(item.name)" :alt="`${item.name} avatar`" loading="lazy" decoding="async" />
                  <svg
                    v-if="isExactPick(item)"
                    class="prediction-crown"
                    viewBox="0 0 256 256"
                    aria-hidden="true"
                    fill="currentColor"
                  >
                    <path d="M44 200h168a12 12 0 0 1 0 24H44a12 12 0 0 1 0-24Zm2.6-122.4a12 12 0 0 1 15.1 2.1l38.8 42.4 17-70.8a12 12 0 0 1 20.9-4.9l17.1 20.5 17.1-20.5a12 12 0 0 1 20.9 4.9l17 70.8 38.8-42.4a12 12 0 0 1 20.6 10.4l-28 88a12 12 0 0 1-11.4 8.4H54.5a12 12 0 0 1-11.4-8.4l-28-88a12 12 0 0 1 31.5-12.5Z"></path>
                  </svg>
                </div>
              </div>

              <div class="grid min-w-0 gap-2 max-md:gap-1.5">
                <div class="flex min-w-0 max-w-full items-center gap-2 overflow-hidden whitespace-nowrap max-sm:gap-1.5">
                  <h3 class="m-0 w-[9ch] shrink-0 truncate text-[15px] font-black leading-tight text-[var(--text)] max-sm:w-[8ch] max-sm:text-[14px]">{{ item.name }}</h3>
                  <span
                    v-if="leadComment(item)"
                    class="inline-flex shrink-0 items-center gap-1 rounded-md border border-[color:color-mix(in_srgb,var(--accent)_16%,var(--line))] bg-[color:color-mix(in_srgb,var(--chip-bg)_60%,transparent)] px-1.5 py-1 text-[10px] font-black uppercase leading-none text-[var(--muted)] [font-variant-numeric:tabular-nums] max-sm:px-1 max-sm:text-[9px]"
                  >
                    <span>{{ activeRoom.home.code }}</span>
                    <strong class="text-[14px] font-[900] text-[var(--text)] max-sm:text-[13px]">{{ item.homeScore }}-{{ item.awayScore }}</strong>
                    <span>{{ activeRoom.away.code }}</span>
                  </span>
                  <span v-if="isOptimisticPrediction(item.id)" class="ml-2 text-[10px] font-black uppercase leading-none text-[var(--accent)]">sending</span>
                </div>

                <div
                  v-if="!leadComment(item)"
                  class="inline-flex w-fit items-center gap-1 rounded-md border border-[color:color-mix(in_srgb,var(--accent)_16%,var(--line))] bg-[color:color-mix(in_srgb,var(--chip-bg)_60%,transparent)] px-2 py-1.5 text-[11px] font-black uppercase leading-none text-[var(--muted)] [font-variant-numeric:tabular-nums] max-sm:px-1.5 max-sm:text-[10px]"
                >
                  <span>{{ activeRoom.home.code }}</span>
                  <strong class="text-[16px] font-[900] text-[var(--text)] max-sm:text-[14px]">{{ item.homeScore }}-{{ item.awayScore }}</strong>
                  <span>{{ activeRoom.away.code }}</span>
                </div>

                <div v-if="leadComment(item)" class="grid gap-1">
                  <p data-lead-comment class="m-0 max-w-[62ch] text-[17px] leading-[1.4] text-[var(--soft)] max-md:text-[15px]">
                    {{ leadComment(item)?.text }}
                    <span v-if="leadComment(item)?.editedAt" class="ml-1 text-[11px] font-bold uppercase text-[var(--muted)]">edited</span>
                  </p>
                </div>

                <div v-if="threadEntries(item).length" data-reply-thread class="grid gap-2 pt-1 pl-3">
                  <TransitionGroup
                    :name="isFastCollapsingComments(item.id) ? 'reply-row-fast' : 'reply-row'"
                    tag="div"
                    class="relative grid gap-1.5 border-l border-[color:color-mix(in_srgb,var(--accent)_34%,var(--line))] pl-3"
                    :class="shouldFadeCommentPreview(item) ? 'after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-8 after:bg-gradient-to-b after:from-transparent after:to-[var(--panel)]' : ''"
                  >
                    <div
                      v-for="(entry, replyIndex) in visibleThreadEntries(item)"
                      :key="entry.id"
                      class="reply-row text-xs leading-[1.45] text-[var(--muted)]"
                      :style="{ '--reply-index': replyIndex }"
                    >
                      <form
                        v-if="entry.type === 'reply' && editingReplyId === entry.id"
                        class="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-1.5 max-sm:grid-cols-[minmax(0,1fr)_auto]"
                        @submit.prevent="submitReplyEdit(replyById(item, entry.id)!)"
                      >
                        <input
                          :data-edit-key="entry.id"
                          v-model="editDrafts[entry.id]"
                          class="min-h-8 w-full rounded-md border border-[var(--control-border)] bg-[var(--control-bg)] px-2 text-xs text-[var(--text)] outline-none focus:border-[color:color-mix(in_srgb,var(--accent)_46%,var(--control-border))] disabled:cursor-wait disabled:opacity-70"
                          maxlength="280"
                          aria-label="Edit reply"
                          :disabled="isEditSubmitting(entry.id)"
                        />
                        <button
                          class="inline-flex min-h-8 items-center justify-center rounded-md bg-[var(--accent)] px-2 text-[10px] font-extrabold text-[var(--accent-text)] transition-[background-color,opacity,transform] duration-100 ease-[cubic-bezier(0.4,0,0.2,1)] hover:bg-[color:color-mix(in_srgb,var(--accent)_86%,black)] active:translate-y-px disabled:cursor-wait disabled:opacity-65 disabled:active:translate-y-0"
                          type="submit"
                          :disabled="!canSubmitEdit(entry.id)"
                        >
                          {{ isEditSubmitting(entry.id) ? 'Saving' : 'Save' }}
                        </button>
                        <button
                          class="inline-flex min-h-8 items-center justify-center rounded-md px-2 text-[10px] font-bold text-[var(--muted)] transition-[background-color,color,transform] duration-100 ease-[cubic-bezier(0.4,0,0.2,1)] hover:bg-[color:color-mix(in_srgb,var(--chip-bg)_70%,transparent)] hover:text-[var(--text)] active:translate-y-px max-sm:col-span-2 max-sm:w-fit"
                          type="button"
                          :disabled="isEditSubmitting(entry.id)"
                          @click="cancelEdit(entry.id)"
                        >
                          Cancel
                        </button>
                        <p v-if="editErrors[entry.id]" class="col-span-full m-0 text-[11px] font-semibold text-[color:color-mix(in_srgb,#d14343_78%,var(--text))]">{{ editErrors[entry.id] }}</p>
                      </form>
                      <span v-else>
                        <strong>{{ entry.name }}:</strong> {{ entry.text }}
                        <span v-if="entry.type === 'reply' && isOptimisticReply(entry.id)" class="ml-1 text-[9px] font-black uppercase text-[var(--accent)]">sending</span>
                        <span v-if="entry.type === 'reply' && isEditSubmitting(entry.id)" class="ml-1 text-[9px] font-black uppercase text-[var(--accent)]">saving</span>
                        <span v-if="entry.editedAt" class="ml-2 text-[9px] font-bold text-[color:color-mix(in_srgb,var(--muted)_82%,var(--text))]">Edited</span>
                        <button
                          v-if="entry.type === 'reply' && replyById(item, entry.id) && canEditReply(replyById(item, entry.id)!)"
                          class="ml-3 inline-flex rounded px-1 text-[9px] font-black uppercase tracking-[0.08em] text-[var(--muted)] transition-[background-color,color,transform] duration-100 ease-[cubic-bezier(0.4,0,0.2,1)] hover:bg-[color:color-mix(in_srgb,var(--chip-bg)_70%,transparent)] hover:text-[var(--accent)] active:translate-y-px"
                          type="button"
                          @click="startEditingReply(replyById(item, entry.id)!)"
                        >
                          EDIT
                        </button>
                      </span>
                    </div>
                  </TransitionGroup>
                  <button
                    v-if="shouldShowCommentToggle(item)"
                    class="ml-3 inline-flex w-fit items-center gap-1.5 rounded-md px-2 py-1 text-[10px] font-[650] leading-tight text-[color:color-mix(in_srgb,var(--accent)_62%,var(--muted))] transition-[background-color,color,transform] duration-100 ease-[cubic-bezier(0.4,0,0.2,1)] hover:bg-[color:color-mix(in_srgb,var(--accent)_6%,transparent)] hover:text-[color:color-mix(in_srgb,var(--accent)_78%,var(--muted))] active:translate-y-px"
                    type="button"
                    :aria-expanded="String(isCommentsExpanded(item.id))"
                    @click="toggleComments(item.id)"
                  >
                    <span>{{ isCommentsExpanded(item.id) ? 'Show less' : `Show ${hiddenReplyCount(item)} more` }}</span>
                  </button>
                  <p
                    v-if="leadComment(item) && typingLabel('reply', leadComment(item)!.id)"
                    class="m-0 min-h-3.5 pl-3 text-[10px] font-[650] leading-tight text-[color:color-mix(in_srgb,var(--accent)_58%,var(--muted))]"
                    aria-live="polite"
                  >
                    {{ typingLabel('reply', leadComment(item)!.id) }}
                  </p>
                </div>

                <Transition
                  name="reply-composer"
                  @after-enter="focusReplyComposer"
                  @after-leave="finishReplyComposerClose(item.id, replyTargetIdForPrediction(item))"
                >
                  <form
                    v-if="isReplying(item.id, replyTargetIdForPrediction(item))"
                    data-reply-composer
                    class="mt-1 grid scroll-mt-24 grid-cols-[minmax(0,1fr)_auto] gap-2 max-md:mb-2 max-md:grid-cols-[minmax(0,1fr)_auto]"
                    @submit.prevent="submitReply(replyTargetIdForPrediction(item))"
                  >
                    <input
                      :data-reply-key="replyTargetIdForPrediction(item)"
                      v-model="replyDrafts[replyTargetIdForPrediction(item)]"
                      class="min-h-9 w-full rounded-lg border border-[var(--control-border)] bg-[var(--control-bg)] px-2.5 text-sm text-[var(--text)] outline-none disabled:cursor-wait disabled:opacity-70"
                      :aria-label="replyComposerLabel(item)"
                      :placeholder="replyComposerPlaceholder(item)"
                      :disabled="isReplySubmitting(replyTargetIdForPrediction(item))"
                      @input="markTyping('reply', replyTargetIdForPrediction(item))"
                      @blur="stopTyping('reply', replyTargetIdForPrediction(item))"
                    />
                    <button
                      class="hidden min-h-9 min-w-9 items-center justify-center rounded-lg border border-[var(--control-border)] bg-[color:color-mix(in_srgb,var(--control-bg)_76%,transparent)] text-[var(--muted)] transition-[background-color,border-color,color,transform] duration-100 ease-[cubic-bezier(0.4,0,0.2,1)] active:translate-y-px max-md:inline-flex"
                      type="button"
                      aria-label="Close reply input"
                      :disabled="isReplySubmitting(replyTargetIdForPrediction(item))"
                      @click="closeReplyComposer(replyTargetIdForPrediction(item))"
                    >
                      <svg class="ph-icon h-4 w-4" viewBox="0 0 256 256" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="20">
                        <path d="M72 72l112 112"></path>
                        <path d="M184 72 72 184"></path>
                      </svg>
                    </button>
                    <button
                      class="inline-flex min-h-9 items-center justify-center rounded-lg bg-[var(--accent)] px-3 text-xs font-extrabold text-[var(--accent-text)] transition-[background-color,opacity,transform] duration-100 ease-[cubic-bezier(0.4,0,0.2,1)] hover:bg-[color:color-mix(in_srgb,var(--accent)_86%,black)] active:translate-y-px disabled:cursor-wait disabled:opacity-65 disabled:active:translate-y-0 max-md:col-span-2"
                      type="submit"
                      :disabled="!canSubmitReply(replyTargetIdForPrediction(item))"
                    >
                      <span>{{ isReplySubmitting(replyTargetIdForPrediction(item)) ? 'sending' : replySubmitLabel(item) }}</span>
                    </button>
                    <p
                      v-if="replyErrors[replyTargetIdForPrediction(item)]"
                      class="col-span-full m-0 text-xs font-semibold text-[color:color-mix(in_srgb,#d14343_78%,var(--text))]"
                    >
                      {{ replyErrors[replyTargetIdForPrediction(item)] }}
                    </p>
                  </form>
                </Transition>
              </div>

              <div class="grid w-[54px] flex-none content-start gap-1.5 justify-self-end max-md:w-[38px] max-md:gap-1">
                <button
                  class="group inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-md border border-transparent bg-transparent px-1.5 text-[12px] font-[720] text-[var(--muted)] transition-[border-color,background-color,color,transform] duration-100 ease-[cubic-bezier(0.4,0,0.2,1)] hover:border-[color:color-mix(in_srgb,var(--accent)_16%,transparent)] hover:bg-[color:color-mix(in_srgb,var(--accent)_7%,transparent)] hover:text-[color:color-mix(in_srgb,var(--accent)_70%,var(--muted))] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-[0.55] disabled:active:translate-y-0 max-md:min-h-8 max-md:min-w-8 max-md:gap-0.5 max-md:px-0 max-md:text-[11px] md:min-h-8 md:min-w-[54px]"
                  :class="likedPredictions.has(item.id) ? 'text-[var(--accent)]' : ''"
                  type="button"
                  :aria-label="`Like prediction from ${item.name}`"
                  @click="submitLike(item.id, item.authorId)"
                >
                  <svg class="ph-icon h-5 w-5 max-md:h-4 max-md:w-4" :class="likedPredictions.has(item.id) ? 'reaction-pop fill-current text-[var(--accent)]' : ''" viewBox="0 0 256 256" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="18">
                    <path d="M128 216S28 160 28 92a52 52 0 0 1 92-33.2L128 68l8-9.2A52 52 0 0 1 228 92c0 68-100 124-100 124Z"></path>
                  </svg>
                  <span :key="item.likes" class="reaction-count [font-variant-numeric:tabular-nums]">{{ item.likes }}</span>
                </button>

                <button
                  class="inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-md border border-transparent bg-transparent px-1.5 text-[12px] font-[720] text-[var(--muted)] transition-[border-color,background-color,color,transform] duration-100 ease-[cubic-bezier(0.4,0,0.2,1)] hover:border-[var(--line)] hover:bg-[color:color-mix(in_srgb,var(--accent)_6%,var(--chip-bg))] hover:text-[var(--accent)] active:translate-y-px max-md:min-h-8 max-md:min-w-8 max-md:gap-0.5 max-md:px-0 max-md:text-[11px] md:min-h-8 md:min-w-[54px]"
                  :class="isReplying(item.id, replyTargetIdForPrediction(item)) ? 'border-[color:color-mix(in_srgb,var(--accent)_24%,var(--line))] bg-[color:color-mix(in_srgb,var(--accent)_9%,var(--chip-bg))] text-[var(--accent)]' : ''"
                  type="button"
                  :aria-expanded="String(isReplying(item.id, replyTargetIdForPrediction(item)))"
                  :aria-label="replyActionLabel(item)"
                  @click="toggleReply(item.id, replyTargetIdForPrediction(item))"
                >
                  <svg class="ph-icon h-5 w-5 max-md:h-4 max-md:w-4" viewBox="0 0 256 256" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="18">
                    <path d="M45.2 188.7A88 88 0 1 1 76 219.5L36 228Z"></path>
                  </svg>
                  <span :key="predictionCommentTotal(item)" class="reaction-count [font-variant-numeric:tabular-nums]">{{ predictionCommentTotal(item) }}</span>
                  <span
                    v-if="hasReplyDraft(replyTargetIdForPrediction(item))"
                    class="h-1.5 w-1.5 rounded-full bg-[var(--accent)]"
                    aria-label="Reply draft saved"
                  ></span>
                </button>
              </div>
              </article>
            </TransitionGroup>
            </div>
          </Transition>
        </section>

        <button
          v-if="feedNavMode !== 'hidden'"
          class="fixed right-4 bottom-[calc(82px+env(safe-area-inset-bottom))] z-[720] hidden h-11 w-11 place-items-center rounded-full border border-[color:color-mix(in_srgb,var(--line)_72%,transparent)] bg-[color:color-mix(in_srgb,var(--panel)_88%,transparent)] text-[var(--text)] backdrop-blur-md transition-[background-color,border-color,color,transform,opacity] duration-150 ease-[var(--ease)] active:translate-y-px max-md:grid"
          type="button"
          :aria-label="feedNavMode === 'up' ? 'Jump to top of comments' : 'Jump to latest comments'"
          @click="handleFeedNavClick"
        >
          <svg v-if="feedNavMode === 'up'" class="ph-icon h-5 w-5" viewBox="0 0 256 256" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="20">
            <path d="M48 152l80-80 80 80"></path>
            <path d="M128 72v136"></path>
          </svg>
          <svg v-else class="ph-icon h-5 w-5" viewBox="0 0 256 256" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="20">
            <path d="M48 104l80 80 80-80"></path>
            <path d="M128 48v136"></path>
          </svg>
        </button>
      </div>

      <aside class="grid gap-3 min-[981px]:sticky min-[981px]:top-4 max-md:hidden">
        <section class="overflow-hidden rounded-xl border border-[var(--line)] bg-[color:color-mix(in_srgb,var(--panel)_88%,transparent)] p-[18px] max-md:rounded-[10px]">
          <div
            class="relative grid pt-1 max-md:pt-[18px]"
            :aria-label="`Room readout carousel for ${activeRoom.home.name} vs ${activeRoom.away.name}`"
          >
            <div
              class="top-pick-carousel h-[218px]"
              :style="{ '--slide-count': topPickInsights.length }"
            >
              <Transition name="top-pick-fade" mode="out-in">
                <article
                  v-if="activeTopPickInsight"
                  :key="`desktop-readout-${activeRoom.id}-${activeTopPickInsight.key}`"
                  class="top-pick-slide desktop-readout-slide relative grid content-start gap-3 px-1 py-2"
                  :class="`top-pick-slide-${activeTopPickInsight.tone}`"
                >
                  <div v-if="activeTopPickInsight.key === 'crowd' && activeTopPickInsight.crowd" class="crowd-readout">
                    <span class="inline-flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.08em] text-[var(--muted)]">
                      <span class="top-pick-emoji text-[20px] leading-none" aria-hidden="true">{{ activeTopPickInsight.icon }}</span>
                      <span>{{ activeTopPickInsight.label }}</span>
                    </span>

                    <div class="crowd-readout-grid">
                      <div class="grid min-w-0 gap-3 text-center">
                        <strong class="crowd-readout-value font-black leading-[0.98] text-[var(--text)]">{{ activeTopPickInsight.value }}</strong>
                        <div class="crowd-readout-attribution">
                          <span>{{ activeTopPickInsight.caption }}</span>
                          <span>{{ activeTopPickInsight.crowd.predictorLabel }}</span>
                        </div>
                      </div>

                      <div class="crowd-readout-stats" aria-label="Room support for the crowd pick">
                        <div class="grid gap-0.5">
                          <span class="text-[28px] font-black leading-none text-[var(--text)]">{{ activeTopPickInsight.crowd.share }}%</span>
                          <span class="text-[10px] font-extrabold uppercase leading-none tracking-[0.08em] text-[var(--muted)]">of room</span>
                        </div>
                        <div class="h-10 w-px bg-[color:color-mix(in_srgb,var(--line)_80%,transparent)]" aria-hidden="true"></div>
                        <div class="grid gap-0.5 text-right">
                          <span class="text-[18px] font-black leading-none text-[var(--text)]">{{ activeTopPickInsight.crowd.pickCount }}/{{ activeTopPickInsight.crowd.total }}</span>
                          <span class="text-[10px] font-extrabold uppercase leading-none tracking-[0.08em] text-[var(--muted)]">picks</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div v-else-if="activeTopPickInsight.winners" class="winner-readout">
                    <span class="inline-flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.08em] text-[var(--muted)]">
                      <span class="top-pick-emoji text-[22px] leading-none" aria-hidden="true">{{ activeTopPickInsight.icon }}</span>
                      <span>{{ activeTopPickInsight.label }}</span>
                    </span>
                    <div class="grid gap-2 text-center">
                      <strong class="winner-readout-value font-black leading-none text-[var(--text)]">{{ activeTopPickInsight.value }}</strong>
                      <span class="winner-readout-score">{{ activeTopPickInsight.caption }}</span>
                    </div>
                    <div class="winner-readout-names" :aria-label="`Exact score ${activeTopPickInsight.label.toLowerCase()}`">
                      <span
                        v-for="name in activeTopPickInsight.winners.names.slice(0, 4)"
                        :key="`winner-${activeRoom.id}-${name}`"
                      >
                        {{ name }}
                      </span>
                      <span v-if="activeTopPickInsight.winners.names.length > 4">
                        +{{ activeTopPickInsight.winners.names.length - 4 }} more
                      </span>
                    </div>
                  </div>

                  <div v-else-if="activeTopPickInsight.weather" class="banter-weather-readout">
                    <span class="inline-flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.08em] text-[var(--muted)]">
                      <span class="top-pick-emoji text-[22px] leading-none" aria-hidden="true">{{ activeTopPickInsight.icon }}</span>
                      <span>{{ activeTopPickInsight.label }}</span>
                    </span>
                    <div class="grid gap-2">
                      <strong class="banter-weather-value font-black leading-none text-[var(--text)]">{{ activeTopPickInsight.value }}</strong>
                      <p class="m-0 text-sm font-[760] leading-snug text-[var(--soft)]">{{ activeTopPickInsight.caption }}</p>
                    </div>
                    <div class="banter-weather-signals" aria-label="Room banter signals">
                      <span>
                        <strong>{{ activeTopPickInsight.weather.picks }}</strong>
                        <small>picks</small>
                      </span>
                      <span>
                        <strong>{{ activeTopPickInsight.weather.comments }}</strong>
                        <small>replies</small>
                      </span>
                      <span>
                        <strong>{{ activeTopPickInsight.weather.likes }}</strong>
                        <small>likes</small>
                      </span>
                    </div>
                  </div>

                  <div v-else-if="!activeTopPickInsight.split" class="grid content-start gap-3">
                    <div class="flex items-center justify-between gap-3">
                      <span class="inline-flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.08em] text-[var(--muted)]">
                        <span class="top-pick-emoji text-[22px] leading-none" aria-hidden="true">{{ activeTopPickInsight.icon }}</span>
                        <span>{{ activeTopPickInsight.label }}</span>
                      </span>
                    </div>
                    <div class="grid gap-1.5">
                      <strong class="text-[clamp(22px,2.35vw,30px)] font-black leading-[1.06] text-[var(--text)]">{{ activeTopPickInsight.value }}</strong>
                      <span class="text-sm font-[720] leading-snug text-[var(--soft)]">{{ activeTopPickInsight.detail }}</span>
                    </div>
                  </div>

                  <div v-else class="grid content-start gap-2">
                    <div class="flex items-center justify-between gap-3">
                      <span class="inline-flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.08em] text-[var(--muted)]">
                        <span class="top-pick-emoji text-[22px] leading-none" aria-hidden="true">{{ activeTopPickInsight.icon }}</span>
                        <span>{{ activeTopPickInsight.label }}</span>
                      </span>
                    </div>
                    <div class="room-split-pitch" aria-hidden="true">
                      <svg viewBox="0 0 320 118" role="img">
                        <rect class="pitch-field" x="2" y="2" width="316" height="114" rx="18"></rect>
                        <rect v-if="activeTopPickInsight.split.home > 0" class="pitch-fill pitch-fill-home" x="2" y="2" :width="activeTopPickInsight.split.home * 3.16" height="114" rx="18"></rect>
                        <rect v-if="activeTopPickInsight.split.draw > 0" class="pitch-fill pitch-fill-draw" :x="160 - activeTopPickInsight.split.draw * 1.58" y="2" :width="activeTopPickInsight.split.draw * 3.16" height="114"></rect>
                        <rect v-if="activeTopPickInsight.split.away > 0" class="pitch-fill pitch-fill-away" :x="318 - activeTopPickInsight.split.away * 3.16" y="2" :width="activeTopPickInsight.split.away * 3.16" height="114" rx="18"></rect>
                        <path class="pitch-line" d="M106.5 2v114M213.5 2v114M160 2v114"></path>
                        <circle class="pitch-center" cx="160" cy="59" r="18"></circle>
                        <path class="pitch-box" d="M2 35h34v48H2M318 35h-34v48h34"></path>
                        <g class="pitch-stat pitch-stat-home">
                          <text x="80" y="52">{{ activeTopPickInsight.split.homeLabel }}</text>
                          <text x="80" y="82">{{ activeTopPickInsight.split.home }}%</text>
                        </g>
                        <g class="pitch-stat pitch-stat-draw">
                          <text x="160" y="55">Draw</text>
                          <text x="160" y="79">{{ activeTopPickInsight.split.draw }}%</text>
                        </g>
                        <g class="pitch-stat pitch-stat-away">
                          <text x="240" y="52">{{ activeTopPickInsight.split.awayLabel }}</text>
                          <text x="240" y="82">{{ activeTopPickInsight.split.away }}%</text>
                        </g>
                      </svg>
                      <div class="room-split-pitch-caption">
                        <span>{{ activeTopPickInsight.detail }}</span>
                      </div>
                    </div>
                  </div>

                  <p
                    v-if="activeTopPickInsight.key !== 'crowd' && !activeTopPickInsight.weather && !activeTopPickInsight.winners"
                    class="room-split-subtitle m-0 text-center text-xs font-[650] leading-snug text-[var(--muted)]"
                  >
                    {{ activeTopPickInsight.caption }}
                  </p>
                </article>
              </Transition>
              <div v-if="topPickInsights.length > 1" class="top-pick-dots top-pick-dots-desktop absolute bottom-1 left-1/2 z-30 flex -translate-x-1/2 items-center gap-1.5" aria-hidden="true">
                <span
                  v-for="(_, index) in topPickInsights"
                  :key="`desktop-dot-${index}`"
                  class="top-pick-dot"
                  :class="{ 'top-pick-dot-active': index === activeTopPickIndex % topPickInsights.length }"
                ></span>
              </div>
            </div>

            <div class="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 border-t border-t-[rgba(229,229,229,0.08)] px-1 pt-3">
              <span class="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-xs font-extrabold uppercase text-[var(--muted)]">{{ activeRoom.home.name }}</span>
              <span class="text-xs font-extrabold uppercase text-[var(--muted)]">vs</span>
              <span class="min-w-0 overflow-hidden text-right text-ellipsis whitespace-nowrap text-xs font-extrabold uppercase text-[var(--muted)]">{{ activeRoom.away.name }}</span>
            </div>

            <button class="mt-2 inline-flex min-h-11 items-center justify-center rounded-lg bg-[var(--accent)] px-[14px] text-[13px] font-extrabold text-[var(--accent-text)] transition-[background-color,opacity,transform] duration-100 ease-[cubic-bezier(0.4,0,0.2,1)] hover:bg-[color:color-mix(in_srgb,var(--accent)_86%,black)] active:translate-y-px disabled:cursor-default disabled:bg-[color:color-mix(in_srgb,var(--accent)_18%,var(--chip-bg))] disabled:text-[color:color-mix(in_srgb,var(--accent)_72%,var(--text))] disabled:opacity-80 disabled:active:translate-y-0" type="button" :disabled="scoreCtaDisabled" @click="openPredictionModal">{{ scoreCtaLabel }}</button>
          </div>
        </section>

        <section class="grid gap-[14px] rounded-xl border border-[var(--line)] bg-[color:color-mix(in_srgb,var(--panel)_88%,transparent)] p-4 max-md:rounded-[10px]">
          <div class="flex items-center gap-2.5">
            <svg class="ph-icon h-[18px] w-[18px] text-[var(--muted)]" viewBox="0 0 256 256" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="18">
              <path d="M84 176H48a16 16 0 0 1-16-16V64a16 16 0 0 1 16-16h160a16 16 0 0 1 16 16v96a16 16 0 0 1-16 16h-72l-40 32Z"></path>
              <path d="M84 96h88"></path>
              <path d="M84 128h56"></path>
            </svg>
            <h2 class="m-0">Chat rooms</h2>
          </div>

          <div class="grid gap-2.5 max-md:gap-3" aria-label="Match rooms for the current cycle">
            <button
              v-for="room in visibleRooms"
              :key="room.id"
              class="grid min-h-[62px] w-full items-center gap-3 rounded-lg border-0 border-t border-t-[color:color-mix(in_srgb,var(--line)_86%,transparent)] bg-transparent p-3 text-left text-[var(--text)] transition-[background-color,border-color,transform] duration-100 ease-[cubic-bezier(0.4,0,0.2,1)] first:border-t-0 first:pt-0.5 hover:bg-[color:color-mix(in_srgb,var(--chip-bg)_70%,transparent)] active:translate-y-px max-md:grid-cols-1 max-md:items-start"
              :class="[
                room.id === activeRoomId ? 'grid-cols-[minmax(0,1fr)_auto] border-t-transparent bg-[color:color-mix(in_srgb,var(--accent)_5%,transparent)] outline outline-1 outline-[color:color-mix(in_srgb,var(--accent)_24%,var(--line))] hover:bg-[color:color-mix(in_srgb,var(--accent)_8%,black)]' : 'grid-cols-[minmax(0,1fr)_auto]',
                effectiveRoomMatchStatus(room) === 'finished' ? 'text-[var(--muted)]' : '',
                isRoomRecentlyUpdated(room.id) ? 'room-update-pulse' : '',
              ]"
              type="button"
              @click="setActiveRoom(room.id)"
            >
              <span class="grid min-w-0 grid-cols-[58px_3ch_auto_58px_3ch] items-center gap-2 whitespace-nowrap font-[850]">
                <span v-if="hasSpriteFlag(room.home)" :class="['ref-flag', flagClass(room.home)]" :aria-label="`${room.home.name} flag`"></span>
                <span v-else class="ref-flag flag-fallback flag-fallback-inline" :aria-label="`${room.home.name} flag`">{{ room.home.flag || room.home.code }}</span>
                <span>{{ room.home.code }}</span>
                <span class="ref-versus justify-self-center">v</span>
                <span v-if="hasSpriteFlag(room.away)" :class="['ref-flag', flagClass(room.away)]" :aria-label="`${room.away.name} flag`"></span>
                <span v-else class="ref-flag flag-fallback flag-fallback-inline" :aria-label="`${room.away.name} flag`">{{ room.away.flag || room.away.code }}</span>
                <span>{{ room.away.code }}</span>
              </span>

              <span class="inline-flex min-h-8 min-w-11 items-center justify-center gap-2.5 text-[color:color-mix(in_srgb,var(--accent)_62%,var(--text))]" :aria-label="roomStatusLabel(room)">
                <span v-if="showsLiveRoomIcon(room)" class="grid justify-items-center gap-0.5 text-[9px] font-black uppercase leading-none text-[var(--accent)]">
                  <span>Live</span>
                  <span
                    class="live-pulse-dot h-2.5 w-2.5 rounded-full bg-current"
                    aria-hidden="true"
                  ></span>
                </span>
                <svg
                  v-else-if="effectiveRoomMatchStatus(room) === 'finished' || room.roomStatus === 'closed'"
                  class="ph-icon h-4 w-4"
                  viewBox="0 0 256 256"
                  aria-hidden="true"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="18"
                >
                  <rect x="48" y="108" width="160" height="104" rx="16"></rect>
                  <path d="M88 108V76a40 40 0 0 1 80 0v32"></path>
                </svg>
                <span v-else class="grid justify-items-center gap-0.5 leading-none">
                  <span v-if="roomKickoffTime(room)" class="text-[9px] font-black tabular-nums text-[color:color-mix(in_srgb,var(--accent)_76%,var(--text))]">{{ roomKickoffTime(room) }}</span>
                  <svg
                    class="ph-icon h-4 w-4"
                    viewBox="0 0 256 256"
                    aria-hidden="true"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="18"
                  >
                    <circle cx="128" cy="128" r="84"></circle>
                    <path d="M128 76v56l38 22"></path>
                  </svg>
                </span>
              </span>
            </button>
          </div>

          <div v-if="roomDayBuckets.length > 1" class="flex items-center justify-between border-t border-[var(--line)] pt-2 text-[var(--muted)]" aria-label="Room pages">
              <button
                class="inline-grid h-8 w-8 place-items-center rounded-md text-[var(--muted)] transition-[background-color,color,transform] duration-100 ease-[cubic-bezier(0.4,0,0.2,1)] hover:bg-[var(--chip-bg)] hover:text-[var(--accent)] active:translate-y-px disabled:pointer-events-none disabled:opacity-25"
                type="button"
                aria-label="Previous rooms"
                :disabled="!leftRoomBucket"
                @click="previousRoomPage"
              >
                <svg class="ph-icon h-4 w-4" viewBox="0 0 256 256" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="22">
                  <path d="M160 48 80 128l80 80"></path>
                </svg>
              </button>
              <span class="text-[11px] font-bold text-[var(--muted)]">{{ roomPageLabel }}</span>
              <button
                class="inline-grid h-8 w-8 place-items-center rounded-md text-[var(--muted)] transition-[background-color,color,transform] duration-100 ease-[cubic-bezier(0.4,0,0.2,1)] hover:bg-[var(--chip-bg)] hover:text-[var(--accent)] active:translate-y-px disabled:pointer-events-none disabled:opacity-25"
                type="button"
                aria-label="Next rooms"
                :disabled="!rightRoomBucket"
                @click="nextRoomPage"
              >
                <svg class="ph-icon h-4 w-4" viewBox="0 0 256 256" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="22">
                  <path d="m96 48 80 80-80 80"></path>
                </svg>
              </button>
          </div>

          <form class="grid gap-2 pt-1" @submit.prevent="openIdentityPrompt('Set your room name and pickup verification before posting.')">
            <label class="text-[11px] font-extrabold uppercase text-[var(--muted)]" for="username">Username</label>
            <div class="grid items-center gap-2" :class="username ? 'grid-cols-1' : 'grid-cols-[minmax(0,1fr)_auto]'">
              <input
                id="username"
                v-model="usernameDraft"
                class="min-h-11 w-full rounded-lg border border-[var(--control-border)] bg-[var(--control-bg)] px-3.5 text-base font-medium text-[var(--text)] outline-none transition-[border-color,box-shadow,opacity] duration-200 ease-[var(--ease)] placeholder:text-[color:color-mix(in_srgb,var(--muted)_88%,transparent)] focus:border-[color:color-mix(in_srgb,var(--accent)_46%,var(--control-border))] focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_10%,transparent)] disabled:cursor-not-allowed disabled:border-[var(--line)] disabled:bg-[color:color-mix(in_srgb,var(--control-bg)_72%,var(--panel))] disabled:text-[var(--soft)] disabled:opacity-100 disabled:focus:shadow-none"
                autocomplete="nickname"
                maxlength="24"
                placeholder="Your name"
                :disabled="!!username"
              />
              <button
                v-if="!username"
                class="inline-flex h-11 min-w-[82px] flex-none items-center justify-center gap-1.5 rounded-lg border border-[color:color-mix(in_srgb,var(--accent)_30%,var(--control-border))] bg-[color:color-mix(in_srgb,var(--accent)_6%,var(--control-bg))] px-3.5 text-sm font-[750] leading-none text-[var(--accent)] transition-[border-color,background-color,color,box-shadow,opacity,transform] duration-150 ease-[var(--ease)] hover:border-[color:color-mix(in_srgb,var(--accent)_44%,var(--control-border))] hover:bg-[color:color-mix(in_srgb,var(--accent)_10%,var(--control-bg))] active:translate-y-px disabled:pointer-events-none disabled:cursor-not-allowed disabled:border-[var(--line)] disabled:bg-[color:color-mix(in_srgb,var(--control-bg)_76%,var(--panel))] disabled:text-[var(--muted)] disabled:opacity-[0.58] disabled:shadow-none disabled:active:translate-y-0"
                type="submit"
                :disabled="usernameDraft.trim().length === 0"
                :aria-label="usernameDraft.trim().length > 0 ? 'Set up username' : 'Enter username to set up'"
              >
                <svg
                  class="ph-icon h-4 w-4 flex-none"
                  viewBox="0 0 256 256"
                  aria-hidden="true"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="18"
                >
                  <path d="M48 56h124l36 36v108a16 16 0 0 1-16 16H64a16 16 0 0 1-16-16Z"></path>
                  <path d="M88 56v64h72V56"></path>
                  <path d="M88 216v-56h80v56"></path>
                </svg>
                <span>Set up</span>
              </button>
            </div>
            <p
              class="flex min-h-0 items-center justify-between gap-2 text-[11px] leading-tight"
              :class="usernameError ? 'text-[var(--danger)]' : 'text-[var(--muted)]'"
            >
              <span>{{ usernameError || usernameConflictMessage || (username ? 'Saved locally for this browser' : '') }}</span>
              <button
                v-if="username && showUsernameReset"
                class="text-[11px] font-bold text-[var(--accent)] transition-[color,transform] duration-100 ease-[cubic-bezier(0.4,0,0.2,1)] hover:text-[color:color-mix(in_srgb,var(--accent)_78%,black)] active:translate-y-px"
                type="button"
                @click="resetUsername"
              >Reset</button>
            </p>
          </form>
        </section>
      </aside>
    </section>

    <IdentityPrompt
      ref="identityPrompt"
      v-model:username-draft="usernameDraft"
      v-model:prize-question-draft="prizeQuestionDraft"
      v-model:prize-answer-draft="prizeAnswerDraft"
      :open="identityPromptOpen"
      :can-save="canSaveUsername"
      :has-saved-username="!!username"
      :error="usernameError || usernameConflictMessage"
      :message="identityPromptMessage"
      @close="closeIdentityPrompt"
      @save="saveUsername"
    />

    <ScoreDrawer
      ref="scoreDrawer"
      v-model:home-score="predictionForm.homeScore"
      v-model:away-score="predictionForm.awayScore"
      v-model:comment="predictionForm.comment"
      :open="predictionModalOpen"
      :room="activeRoom"
      :submitting="submittingPrediction"
      :can-submit="canSubmitPrediction"
      :closed="activeRoomPredictionsClosed"
      @close="closePredictionModal"
      @submit="submitPrediction"
    />
    </div>
  </main>
</template>
