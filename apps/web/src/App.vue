<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { loadFixtures, MATCH_LIVE_DURATION_MS, matchKickoffUtc, mockThemes, type ApiEvent, type CreatePredictionInput, type MatchStatus, type Prediction, type ReplyInput, type Room, type Team, type ThemeId } from '@wc-chatter/shared'
import 'flag-icons/css/flag-icons.min.css'
import { connectRoomEvents, createPrediction, createReply, fetchBootstrap, togglePredictionLike } from './lib/api'
import { createNaviiIcon } from './lib/navii'
import {
  getOrCreateUserId,
  getStoredLikes,
  getStoredTheme,
  getStoredUsername,
  setStoredUsername,
  setStoredLikes,
  setStoredTheme,
} from './lib/storage'

const USERNAME_PATTERN = /^[A-Za-zÀ-ÖØ-öø-ÿ0-9 .'-]{2,24}$/
const COMMENT_PREVIEW_LIMIT = 3
const ROOM_PAGE_SIZE = 4
const ROOM_REFRESH_MS = 60_000
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
type RealtimeStatus = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'offline'
type PendingIdentityAction =
  | { type: 'like'; predictionId: string; authorId?: string }
  | { type: 'reply'; predictionId: string; commentId: string }
  | { type: 'prediction' }
type FaviconTheme = {
  accent: string
  panel: string
  text: string
}

const faviconThemes: Record<ThemeId, FaviconTheme> = {
  paper: { accent: '#b45309', panel: '#fff9ec', text: '#2a2520' },
  desk: { accent: '#315c4c', panel: '#ffffff', text: '#20231f' },
  pub: { accent: '#d6a43a', panel: '#23211d', text: '#1c1c1c' },
  press: { accent: '#9a3412', panel: '#fbfaf4', text: '#1c1917' },
}

const userId = getOrCreateUserId()
const username = ref(getStoredUsername())
const usernameDraft = ref(username.value)
const usernameError = ref('')
const rooms = ref<Room[]>([])
const activeRoomId = ref('')
const loading = ref(true)
const refreshingRooms = ref(false)
const errorMessage = ref('')
const mutationError = ref('')
const realtimeStatus = ref<RealtimeStatus>('idle')
const routePath = ref(window.location.pathname)
const predictionModalOpen = ref(false)
const submittingPrediction = ref(false)
const identityPromptOpen = ref(false)
const identityPromptMessage = ref('')
const themeMenuOpen = ref(false)
const selectedTheme = ref<ThemeId>(getStoredTheme() as ThemeId)
const feedSortMode = ref<FeedSortMode>('likes')
const roomPage = ref(0)
const likedPredictions = ref(getStoredLikes())
const activeReplyTarget = ref<{ predictionId: string; commentId: string } | null>(null)
const expandedCommentCards = ref(new Set<string>())
const fastCollapsingCommentCards = ref(new Set<string>())
const pendingIdentityAction = ref<PendingIdentityAction | null>(null)
const themeTrigger = ref<HTMLElement | null>(null)
const identityPromptInput = ref<HTMLInputElement | null>(null)
const themeMenuStyle = ref<Record<string, string>>({})
const ws = ref<WebSocket | null>(null)
const submittingReplies = ref(new Set<string>())
const replyErrors = reactive<Record<string, string>>({})
let identityPromptTimer: ReturnType<typeof window.setTimeout> | null = null
let mutationErrorTimer: ReturnType<typeof window.setTimeout> | null = null
let reconnectTimer: ReturnType<typeof window.setTimeout> | null = null
let roomRefreshTimer: ReturnType<typeof window.setInterval> | null = null
let fastCommentCollapseTimer: ReturnType<typeof window.setTimeout> | null = null
let reconnectAttempt = 0
let socketToken = 0
let roomsRefreshInFlight = false

const predictionForm = reactive({
  homeScore: 2,
  awayScore: 1,
  comment: '',
})

const replyDrafts = reactive<Record<string, string>>({})

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
const canSaveUsername = computed(() => !username.value && usernameDraft.value.trim().length > 0)
const canSortPredictions = computed(() => (activeRoom.value?.predictions.length ?? 0) > 0)
const isNotFound = computed(() => routePath.value !== '/')
const orderedRooms = computed(() => [...rooms.value].sort(compareRoomsForSwitcher))
const roomPageCount = computed(() => Math.max(1, Math.ceil(orderedRooms.value.length / ROOM_PAGE_SIZE)))
const visibleRooms = computed(() => {
  const start = roomPage.value * ROOM_PAGE_SIZE
  return orderedRooms.value.slice(start, start + ROOM_PAGE_SIZE)
})
const roomPageLabel = computed(() => `${roomPage.value + 1}/${roomPageCount.value}`)
const statusNotice = computed(() => {
  if (mutationError.value) return mutationError.value
  if (refreshingRooms.value) return 'Refreshing rooms...'
  if (realtimeStatus.value === 'connecting') return 'Connecting to live room...'
  if (realtimeStatus.value === 'reconnecting') return 'Live updates paused. Reconnecting...'
  if (realtimeStatus.value === 'offline') return 'Live updates are offline. Retrying...'
  return ''
})

watch(selectedTheme, (value) => {
  document.body.dataset.theme = value === 'paper' ? '' : value
  setStoredTheme(value)
  updateFavicon(value)
}, { immediate: true })

watch(activeRoom, (room) => {
  if (!room) return
  predictionForm.homeScore = room.mostBacked.home
  predictionForm.awayScore = room.mostBacked.away
})

watch(activeRoomId, (roomId) => {
  connectActiveRoomEvents(roomId)
})

watch(rooms, () => {
  if (roomPage.value >= roomPageCount.value) {
    roomPage.value = roomPageCount.value - 1
  }
})

watch(username, (value) => {
  if (value) usernameDraft.value = value
})

function validateUsername(value: string) {
  const normalized = value.normalize('NFKC').replace(/\s+/g, ' ').trim().slice(0, 24)
  if (!USERNAME_PATTERN.test(normalized)) {
    return {
      ok: false,
      value: normalized,
      message: "Use 2-24 chars: letters, numbers, spaces, . ' -",
    }
  }

  return { ok: true, value: normalized, message: '' }
}

function saveUsername() {
  const result = validateUsername(usernameDraft.value)
  if (!result.ok) {
    usernameError.value = result.message
    return
  }

  username.value = result.value
  usernameDraft.value = result.value
  usernameError.value = ''
  setStoredUsername(result.value)
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
  usernameError.value = ''
  setStoredUsername('')
}

function openIdentityPrompt(message = 'Set your username first.', action?: PendingIdentityAction) {
  if (username.value) return true
  if (action) pendingIdentityAction.value = action
  identityPromptMessage.value = message
  usernameError.value = message
  identityPromptOpen.value = true
  nextTick(() => identityPromptInput.value?.focus())
  return false
}

function closeIdentityPrompt(clearPendingAction = true) {
  identityPromptOpen.value = false
  if (clearPendingAction) pendingIdentityAction.value = null
}

function requireUsername(message = 'Set your username first.', action?: PendingIdentityAction) {
  if (username.value) return true
  return openIdentityPrompt(message, action)
}

function openPredictionModal() {
  if (!requireUsername('Set your username before posting.', { type: 'prediction' })) return
  predictionModalOpen.value = true
}

function closePredictionModal() {
  predictionModalOpen.value = false
}

function errorText(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
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
  return `flag fi fi-${team.iso2.toLowerCase()}`
}

function hasSpriteFlag(team: Team) {
  return !!team.iso2
}

function predictionAvatar(name: string) {
  return createNaviiIcon(name, `${name} avatar`)
}

function leadComment(prediction: Prediction) {
  return prediction.comments[0] ?? null
}

function predictionCommentTotal(prediction: Prediction) {
  return prediction.comments.reduce((sum, comment) => sum + 1 + comment.replies.length, 0)
}

function isCommentsExpanded(predictionId: string) {
  return expandedCommentCards.value.has(predictionId)
}

function isFastCollapsingComments(predictionId: string) {
  return fastCollapsingCommentCards.value.has(predictionId)
}

function sortedReplies(prediction: Prediction) {
  return [...(leadComment(prediction)?.replies ?? [])].sort(
    (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
  )
}

function showsFullThread(prediction: Prediction) {
  const comment = leadComment(prediction)
  return !!comment && (isCommentsExpanded(prediction.id) || isReplying(prediction.id, comment.id))
}

function visibleReplies(prediction: Prediction) {
  const replies = sortedReplies(prediction)
  return showsFullThread(prediction) ? replies : replies.slice(0, COMMENT_PREVIEW_LIMIT)
}

function hiddenReplyCount(prediction: Prediction) {
  const replies = sortedReplies(prediction)
  return Math.max(0, replies.length - COMMENT_PREVIEW_LIMIT)
}

function shouldShowCommentToggle(prediction: Prediction) {
  const comment = leadComment(prediction)
  return !!comment && !isReplying(prediction.id, comment.id) && hiddenReplyCount(prediction) > 0
}

function shouldFadeCommentPreview(prediction: Prediction) {
  return shouldShowCommentToggle(prediction) && !isCommentsExpanded(prediction.id)
}

function roomKickoffIso(room: Room) {
  return room.kickoffAt ?? fixtureKickoffs.get(room.id) ?? fixtureKickoffs.get(`${room.home.code}-${room.away.code}`) ?? ''
}

function roomKickoffMs(room: Room) {
  const kickoffIso = roomKickoffIso(room)
  if (!kickoffIso) return Number.POSITIVE_INFINITY

  const kickoffMs = Date.parse(kickoffIso)
  return Number.isFinite(kickoffMs) ? kickoffMs : Number.POSITIVE_INFINITY
}

function effectiveRoomMatchStatus(room: Room): MatchStatus {
  if (room.currentScore?.status === 'finished') return 'finished'
  if (room.currentScore?.status === 'live') return 'live'

  const kickoffIso = roomKickoffIso(room)
  if (kickoffIso) {
    const kickoffMs = Date.parse(kickoffIso)
    if (Number.isFinite(kickoffMs)) {
      const nowMs = Date.now()
      if (nowMs < kickoffMs) return 'upcoming'
      if (nowMs <= kickoffMs + MATCH_LIVE_DURATION_MS) return 'live'
      return 'finished'
    }
  }

  return room.matchStatus
}

function showsLiveRoomIcon(room: Room) {
  return effectiveRoomMatchStatus(room) === 'live'
}

function isLockedRoom(room: Room) {
  return effectiveRoomMatchStatus(room) === 'finished' || room.roomStatus === 'closed'
}

function roomLockedAtMs(room: Room) {
  const scoreUpdatedAt = room.currentScore?.status === 'finished' ? Date.parse(room.currentScore.updatedAt) : NaN
  if (Number.isFinite(scoreUpdatedAt)) return scoreUpdatedAt

  const kickoffMs = roomKickoffMs(room)
  if (Number.isFinite(kickoffMs)) return kickoffMs + MATCH_LIVE_DURATION_MS

  return Number.NEGATIVE_INFINITY
}

function compareRoomsForSwitcher(left: Room, right: Room) {
  const leftLocked = isLockedRoom(left)
  const rightLocked = isLockedRoom(right)
  if (leftLocked !== rightLocked) return leftLocked ? 1 : -1

  if (leftLocked && rightLocked) {
    return roomLockedAtMs(right) - roomLockedAtMs(left)
  }

  const leftLive = effectiveRoomMatchStatus(left) === 'live'
  const rightLive = effectiveRoomMatchStatus(right) === 'live'
  if (leftLive !== rightLive) return leftLive ? -1 : 1

  return roomKickoffMs(left) - roomKickoffMs(right)
}

function roomKickoffTime(room: Room) {
  const kickoffIso = roomKickoffIso(room)
  if (!kickoffIso) return ''

  const kickoff = new Date(kickoffIso)
  if (Number.isNaN(kickoff.getTime())) return ''

  return `${String(kickoff.getHours()).padStart(2, '0')}:${String(kickoff.getMinutes()).padStart(2, '0')}`
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
  if (matchStatus === 'finished') return 'Played'
  if (room.roomStatus === 'closed') return 'Closed'
  return 'Draft'
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

function isReplying(predictionId: string, commentId: string) {
  return (
    activeReplyTarget.value?.predictionId === predictionId &&
    activeReplyTarget.value?.commentId === commentId
  )
}

function isReplySubmitting(commentId: string) {
  return submittingReplies.value.has(commentId)
}

function canSubmitReply(commentId: string) {
  return !isReplySubmitting(commentId) && !!(replyDrafts[commentId] || '').trim()
}

function setActiveRoom(roomId: string) {
  activeRoomId.value = roomId
  activeReplyTarget.value = null
  expandedCommentCards.value = new Set()
  fastCollapsingCommentCards.value = new Set()
}

function previousRoomPage() {
  roomPage.value = Math.max(0, roomPage.value - 1)
}

function nextRoomPage() {
  roomPage.value = Math.min(roomPageCount.value - 1, roomPage.value + 1)
}

function toggleFeedSort() {
  if (!canSortPredictions.value) return
  feedSortMode.value = feedSortMode.value === 'likes' ? 'comments' : 'likes'
}

async function submitPrediction() {
  if (submittingPrediction.value) return
  if (!activeRoom.value || !requireUsername('Set your username before posting.')) return

  const payload: CreatePredictionInput = {
    authorId: userId,
    name: username.value,
    homeScore: predictionForm.homeScore,
    awayScore: predictionForm.awayScore,
    comment: predictionForm.comment,
  }

  submittingPrediction.value = true

  try {
    const response = await createPrediction(activeRoom.value.id, payload)
    patchRoom(response.room)
    predictionForm.comment = ''
    closePredictionModal()
  } catch (error) {
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

  try {
    const response = await togglePredictionLike(predictionId, { userId, liked })
    patchRoom(response.room)
  } catch (error) {
    likedPredictions.value = previousLikes
    setStoredLikes(previousLikes)
    showMutationError(errorText(error, 'Like did not update. Try again.'))
  }
}

function openReplyComposer(predictionId: string, commentId: string) {
  expandedCommentCards.value = new Set()
  fastCollapsingCommentCards.value = new Set()
  activeReplyTarget.value = { predictionId, commentId }
}

function toggleReply(predictionId: string, commentId: string) {
  if (!requireUsername('Set your username before replying.', { type: 'reply', predictionId, commentId })) return
  if (isReplying(predictionId, commentId)) {
    activeReplyTarget.value = null
    return
  }

  openReplyComposer(predictionId, commentId)
}

function focusReplyComposer(element: Element) {
  element.querySelector<HTMLInputElement>('input[data-reply-key]')?.focus()
}

async function runPendingIdentityAction(action: PendingIdentityAction) {
  if (action.type === 'prediction') {
    openPredictionModal()
    return
  }

  if (action.type === 'reply') {
    openReplyComposer(action.predictionId, action.commentId)
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

async function submitReply(commentId: string) {
  if (!requireUsername('Set your username before replying.')) return
  const text = (replyDrafts[commentId] || '').trim()
  if (!text || isReplySubmitting(commentId)) return

  const payload: ReplyInput = {
    authorId: userId,
    name: username.value,
    text,
  }

  submittingReplies.value = new Set(submittingReplies.value).add(commentId)
  replyErrors[commentId] = ''

  try {
    const response = await createReply(commentId, payload)
    patchRoom(response.room)
    replyDrafts[commentId] = ''
    activeReplyTarget.value = null
  } catch (error) {
    replyErrors[commentId] = errorText(error, 'Reply did not send. Try again.')
    showMutationError(replyErrors[commentId])
  } finally {
    const nextSubmitting = new Set(submittingReplies.value)
    nextSubmitting.delete(commentId)
    submittingReplies.value = nextSubmitting
  }
}

function patchRoom(nextRoom: Room) {
  const existing = rooms.value.some((room) => room.id === nextRoom.id)
  rooms.value = existing
    ? rooms.value.map((room) => (room.id === nextRoom.id ? nextRoom : room))
    : [nextRoom, ...rooms.value]

  if (!activeRoomId.value) {
    activeRoomId.value = nextRoom.id
  }
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
  if (themeMenuOpen.value) {
    nextTick(positionThemeMenu)
  }
}

function applyTheme(themeId: ThemeId) {
  selectedTheme.value = themeId
  themeMenuOpen.value = false
}

function handleGlobalClick(event: MouseEvent) {
  const target = event.target as HTMLElement | null
  if (!target?.closest('.ui-select')) {
    themeMenuOpen.value = false
  }
}

function handleRouteChange() {
  routePath.value = window.location.pathname
}

function handleSocketEvent(event: MessageEvent<string>) {
  if (event.data === 'pong') return
  const payload = JSON.parse(event.data) as ApiEvent
  if (payload.type === 'bootstrap') {
    patchRoom(payload.room)
    return
  }

  if (payload.type === 'room.updated') {
    patchRoom(payload.room)
  }
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
    if (!options.preserveActiveRoom || !currentRoomExists) {
      activeRoomId.value = response.rooms.find((room) => room.isFeatured)?.id ?? response.rooms[0]?.id ?? ''
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

async function bootstrap() {
  return refreshRooms()
}

onMounted(async () => {
  selectedTheme.value = getStoredTheme() as ThemeId
  if (isNotFound.value) {
    loading.value = false
  } else {
    await bootstrap()
  }
  document.addEventListener('click', handleGlobalClick)
  window.addEventListener('popstate', handleRouteChange)
  window.addEventListener('resize', positionThemeMenu)
  window.addEventListener('scroll', positionThemeMenu, { passive: true })
  const shouldAutoPromptUsername = !window.matchMedia('(max-width: 767px)').matches
  if (!isNotFound.value && !username.value && shouldAutoPromptUsername) {
    identityPromptTimer = window.setTimeout(() => {
      openIdentityPrompt('Choose a username when you are ready.')
    }, 650)
  }
  roomRefreshTimer = window.setInterval(() => {
    if (isNotFound.value || document.hidden) return
    void refreshRooms({ preserveActiveRoom: true, silent: true })
  }, ROOM_REFRESH_MS)
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
  if (roomRefreshTimer) {
    window.clearInterval(roomRefreshTimer)
  }
  if (fastCommentCollapseTimer) {
    window.clearTimeout(fastCommentCollapseTimer)
  }
  socketToken += 1
  ws.value?.close()
  document.removeEventListener('click', handleGlobalClick)
  window.removeEventListener('popstate', handleRouteChange)
  window.removeEventListener('resize', positionThemeMenu)
  window.removeEventListener('scroll', positionThemeMenu)
})
</script>

<template>
  <main class="mx-auto w-[min(1180px,calc(100%-32px))] px-0 pt-6 pb-[42px] max-md:w-[min(100%,calc(100%-24px))] max-md:pt-[18px] max-md:pb-[calc(96px+env(safe-area-inset-bottom))]">
    <header class="mb-[34px] flex items-center justify-between gap-4">
      <div class="flex items-center">
        <div class="inline-flex items-baseline gap-2 whitespace-nowrap text-[clamp(22px,2.2vw,30px)] leading-none font-black text-[var(--accent)]" aria-label="turntabl score room">turntabl <span class="font-[750] text-[var(--text)]">score room</span></div>
      </div>

      <div class="relative z-[var(--layer-dropdown)] w-[46px]" :class="{ open: themeMenuOpen }">
        <button
          ref="themeTrigger"
          class="inline-grid min-h-[46px] w-[46px] items-center justify-center rounded-xl border border-[var(--line)] bg-[var(--chip-bg)] p-0 text-[var(--text)] transition-[background-color,border-color,transform] duration-100 ease-[cubic-bezier(0.4,0,0.2,1)] hover:border-[var(--line-strong)] hover:bg-[color:color-mix(in_srgb,var(--accent)_6%,var(--chip-bg))] active:translate-y-px"
          type="button"
          aria-label="Choose theme"
          :aria-expanded="String(themeMenuOpen)"
          @click.stop="toggleThemeMenu"
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
          class="fixed left-0 top-0 z-[var(--layer-dropdown)] grid gap-0.5 overflow-auto rounded-xl border border-[var(--line-strong)] bg-[var(--panel)] p-1.5 shadow-[0_16px_38px_rgba(15,23,42,0.12)]"
          :style="themeMenuStyle"
          role="listbox"
          aria-label="Theme picker"
        >
          <button
            v-for="theme in mockThemes"
            :key="theme.id"
            class="grid min-h-11 w-full grid-cols-[18px_minmax(0,1fr)] items-center gap-2.5 rounded-lg bg-transparent px-3 text-left text-[13px] font-[750] text-[var(--text)] transition-[background-color,transform] duration-100 ease-[cubic-bezier(0.4,0,0.2,1)] hover:bg-[color:color-mix(in_srgb,var(--accent)_8%,var(--panel))] active:translate-y-px aria-selected:bg-[color:color-mix(in_srgb,var(--accent)_12%,var(--panel))]"
            type="button"
            :aria-selected="String(selectedTheme === theme.id)"
            @click="applyTheme(theme.id)"
          >
            <span class="text-[var(--accent)] font-black">{{ selectedTheme === theme.id ? '✓' : '' }}</span>
            <span>{{ theme.label }}</span>
          </button>
        </div>
      </div>
    </header>

    <Transition name="status-toast">
      <div
        v-if="statusNotice"
        class="fixed right-4 top-4 z-[900] inline-flex min-h-10 max-w-[min(420px,calc(100%-32px))] items-center gap-2 rounded-lg border border-[color:color-mix(in_srgb,var(--accent)_20%,var(--line))] bg-[color:color-mix(in_srgb,var(--panel)_94%,var(--accent)_6%)] px-3.5 py-2 text-xs font-[720] text-[var(--text)] shadow-[0_12px_28px_rgba(0,0,0,0.14)] backdrop-blur-md max-md:left-3 max-md:right-3 max-md:top-3"
        role="status"
        aria-live="polite"
      >
        <span class="h-2 w-2 rounded-full bg-[var(--accent)] shadow-[0_0_0_4px_color-mix(in_srgb,var(--accent)_12%,transparent)]" :class="refreshingRooms || realtimeStatus === 'connecting' || realtimeStatus === 'reconnecting' ? 'animate-pulse' : ''"></span>
        <span>{{ statusNotice }}</span>
      </div>
    </Transition>

    <section
      v-if="isNotFound"
      class="relative grid min-h-[calc(100svh-126px)] overflow-hidden rounded-xl border border-[var(--line)] bg-[color:color-mix(in_srgb,var(--panel)_76%,transparent)] p-[clamp(22px,5vw,64px)] max-md:min-h-[calc(100svh-100px)] max-md:rounded-[10px] max-md:p-4"
      aria-labelledby="not-found-title"
    >
      <div class="pointer-events-none absolute inset-0 opacity-60" aria-hidden="true">
        <div class="absolute left-1/2 top-0 h-full w-px bg-[color:color-mix(in_srgb,var(--accent)_8%,transparent)]"></div>
        <div class="absolute left-1/2 top-1/2 h-[min(42vw,480px)] w-[min(42vw,480px)] -translate-x-1/2 -translate-y-1/2 rounded-full border border-[color:color-mix(in_srgb,var(--accent)_8%,transparent)]"></div>
        <div class="absolute inset-x-[clamp(24px,8vw,120px)] top-1/2 h-px bg-[color:color-mix(in_srgb,var(--accent)_7%,transparent)]"></div>
      </div>

      <div class="relative mx-auto grid h-full w-full max-w-[1040px] content-center justify-items-center gap-[clamp(22px,4vw,42px)]">
        <div class="relative overflow-hidden rounded-xl border border-[color:color-mix(in_srgb,var(--accent)_22%,var(--line))] bg-[color:color-mix(in_srgb,var(--accent)_5%,var(--panel))] p-[clamp(20px,3vw,34px)] shadow-[0_24px_58px_color-mix(in_srgb,var(--accent)_11%,transparent)]">
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
                <div class="grid h-[clamp(60px,6vw,88px)] w-[clamp(60px,6vw,88px)] place-items-center rounded-full border border-[color:color-mix(in_srgb,var(--accent)_24%,var(--line))] bg-[var(--panel)] text-[clamp(30px,3vw,46px)] font-black leading-none text-[var(--accent)] shadow-[0_10px_24px_color-mix(in_srgb,var(--accent)_10%,transparent)]">4</div>
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
                <div class="grid h-[clamp(60px,6vw,88px)] w-[clamp(60px,6vw,88px)] place-items-center rounded-full border border-[color:color-mix(in_srgb,var(--accent)_24%,var(--line))] bg-[var(--panel)] text-[clamp(30px,3vw,46px)] font-black leading-none text-[var(--accent)] shadow-[0_10px_24px_color-mix(in_srgb,var(--accent)_10%,transparent)]">4</div>
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

        <div class="grid max-w-[760px] justify-items-center gap-5 text-center">
          <div class="grid gap-2">
            <p class="m-0 text-xs font-extrabold uppercase tracking-[0.12em] text-[var(--accent)]">404 · full time</p>
            <h1 id="not-found-title" class="m-0 text-[clamp(48px,7vw,96px)] font-black leading-[0.92] text-[var(--text)]">No room on this pitch</h1>
            <p class="m-0 mx-auto max-w-[52ch] text-[clamp(15px,1.35vw,18px)] leading-[1.55] text-[var(--soft)]">That link does not match any active score room. Jump back to the room list and pick a fixture that is actually on the board.</p>
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

    <section v-else-if="loading" class="grid max-h-[calc(100svh-118px)] items-start gap-[18px] overflow-hidden min-[981px]:grid-cols-[minmax(0,1fr)_minmax(320px,30%)] max-md:max-h-[calc(100svh-96px)]" aria-label="Loading score room">
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
              class="prediction relative grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3 overflow-hidden rounded-xl border border-[var(--line)] bg-[color:color-mix(in_srgb,var(--panel)_88%,transparent)] p-4 shadow-[var(--card-shadow)] max-md:rounded-[10px] max-md:p-3.5"
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
        <section class="overflow-hidden rounded-xl border border-[var(--line)] bg-[color:color-mix(in_srgb,var(--panel)_88%,transparent)] p-[18px] shadow-[var(--card-shadow)] max-md:rounded-[10px]">
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

        <section class="grid gap-[14px] rounded-xl border border-[var(--line)] bg-[color:color-mix(in_srgb,var(--panel)_88%,transparent)] p-4 shadow-[var(--card-shadow)] max-md:rounded-[10px]">
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
        <div class="relative overflow-hidden rounded-xl border border-[color:color-mix(in_srgb,var(--accent)_22%,var(--line))] bg-[color:color-mix(in_srgb,var(--accent)_5%,var(--panel))] p-[clamp(20px,3vw,34px)] shadow-[0_24px_58px_color-mix(in_srgb,var(--accent)_11%,transparent)]">
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
                <div class="grid h-[clamp(60px,6vw,88px)] w-[clamp(60px,6vw,88px)] place-items-center rounded-full border border-[color:color-mix(in_srgb,var(--accent)_24%,var(--line))] bg-[var(--panel)] text-[clamp(30px,3vw,46px)] font-black leading-none text-[var(--accent)] shadow-[0_10px_24px_color-mix(in_srgb,var(--accent)_10%,transparent)]">?</div>
                <span class="text-[11px] font-extrabold uppercase tracking-[0.08em] text-[var(--muted)]">Rooms</span>
              </div>
              <div class="inline-flex items-center gap-[clamp(8px,1.6vw,18px)] [font-variant-numeric:tabular-nums]">
                <span class="text-[clamp(76px,10vw,148px)] font-black leading-none text-[var(--text)]">0</span>
                <span class="versus text-[clamp(22px,3vw,34px)] font-semibold leading-none">v</span>
                <span class="text-[clamp(76px,10vw,148px)] font-black leading-none text-[var(--text)]">0</span>
              </div>
              <div class="grid justify-items-center gap-2">
                <div class="grid h-[clamp(60px,6vw,88px)] w-[clamp(60px,6vw,88px)] place-items-center rounded-full border border-[color:color-mix(in_srgb,var(--accent)_24%,var(--line))] bg-[var(--panel)] text-[clamp(30px,3vw,46px)] font-black leading-none text-[var(--accent)] shadow-[0_10px_24px_color-mix(in_srgb,var(--accent)_10%,transparent)]">?</div>
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
    <section v-else-if="!rooms.length" class="grid min-h-[420px] place-items-center rounded-xl border border-[var(--line)] bg-[color:color-mix(in_srgb,var(--panel)_88%,transparent)] p-8 text-center shadow-[var(--card-shadow)]">
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
    <section v-else-if="activeRoom" class="grid items-start gap-[18px] min-[981px]:grid-cols-[minmax(0,1fr)_minmax(320px,30%)]">
      <div class="grid gap-[18px] max-md:gap-3">
        <button
          v-if="sortedPredictions.length"
          class="hidden min-h-12 w-full items-center justify-center rounded-xl bg-[var(--accent)] px-4 text-[15px] font-extrabold text-[var(--accent-text)] shadow-[0_12px_26px_color-mix(in_srgb,var(--accent)_18%,transparent)] transition-[background-color,transform] duration-150 ease-[var(--ease)] active:translate-y-px max-md:inline-flex"
          type="button"
          @click="openPredictionModal"
        >
          Drop your score
        </button>

        <div class="match-stage-sticky">
          <section class="match-stage relative overflow-hidden rounded-xl border border-[var(--line)] p-7 max-md:min-h-0 max-md:rounded-[10px] max-md:p-4">
            <div class="relative z-[1] my-7 grid gap-[18px] max-md:my-3 max-md:gap-3">
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

              <div class="mt-0.5 grid w-full grid-cols-3 gap-0 border-t border-[var(--line)] pt-4 max-md:pt-3" aria-label="Event stats">
                <div class="min-h-[58px] px-5 max-md:min-h-[46px] max-md:px-2">
                  <strong class="block text-[clamp(30px,3vw,44px)] leading-[0.95] max-md:text-[26px]">{{ activeRoom.predictions.length }}</strong>
                  <span class="mt-2 block text-[13px] font-[650] text-[var(--muted)] max-md:mt-1 max-md:text-[11px]">Predictions</span>
                </div>
                <div class="min-h-[58px] border-l border-[var(--line)] px-5 max-md:min-h-[46px] max-md:px-2">
                  <strong class="block text-[clamp(30px,3vw,44px)] leading-[0.95] max-md:text-[26px]">{{ totalLikes }}</strong>
                  <span class="mt-2 block text-[13px] font-[650] text-[var(--muted)] max-md:mt-1 max-md:text-[11px]">Likes</span>
                </div>
                <div class="min-h-[58px] border-l border-[var(--line)] px-5 max-md:min-h-[46px] max-md:px-2">
                  <strong class="block text-[clamp(30px,3vw,44px)] leading-[0.95] max-md:text-[26px]">{{ totalComments }}</strong>
                  <span class="mt-2 block text-[13px] font-[650] text-[var(--muted)] max-md:mt-1 max-md:text-[11px]">Replies</span>
                </div>
              </div>
            </div>

            <p
              class="mt-1 text-center text-[15px] leading-[1.45] font-medium text-[var(--muted)] max-md:hidden"
            >
              Drop your score and let the room react.
            </p>
          </section>
        </div>

        <section class="grid gap-2 rounded-[10px] border border-[var(--line)] bg-[color:color-mix(in_srgb,var(--panel)_88%,transparent)] p-3 shadow-[var(--card-shadow)] md:hidden" aria-label="Mobile chat rooms">
          <div class="flex items-center justify-between gap-3">
            <div class="flex items-center gap-2">
              <svg class="ph-icon h-4 w-4 text-[var(--muted)]" viewBox="0 0 256 256" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="18">
                <path d="M84 176H48a16 16 0 0 1-16-16V64a16 16 0 0 1 16-16h160a16 16 0 0 1 16 16v96a16 16 0 0 1-16 16h-72l-40 32Z"></path>
                <path d="M84 96h88"></path>
                <path d="M84 128h56"></path>
              </svg>
              <h2 class="m-0 text-base font-[760] leading-tight text-[var(--text)]">Chat rooms</h2>
            </div>
            <span class="text-[11px] font-bold text-[var(--muted)]">{{ rooms.length }} rooms</span>
          </div>

          <div class="-mx-3 flex snap-x gap-2 overflow-x-auto px-3 pb-1" aria-label="Match rooms for the current cycle">
            <button
              v-for="room in orderedRooms"
              :key="room.id"
              class="grid min-h-[76px] min-w-[250px] snap-start grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg border p-2.5 text-left transition-[background-color,border-color,transform] duration-150 ease-[var(--ease)] active:translate-y-px"
              :class="[
                room.id === activeRoomId ? 'border-[color:color-mix(in_srgb,var(--accent)_34%,var(--line))] bg-[color:color-mix(in_srgb,var(--accent)_6%,var(--panel))]' : 'border-[var(--line)] bg-[color:color-mix(in_srgb,var(--chip-bg)_46%,transparent)]',
                effectiveRoomMatchStatus(room) === 'finished' ? 'opacity-80' : '',
              ]"
              type="button"
              @click="setActiveRoom(room.id)"
            >
              <span class="grid min-w-0 gap-1.5">
                <span class="grid min-w-0 grid-cols-[42px_3ch_auto_42px_3ch] items-center gap-1.5 text-[15px] font-[850] leading-none text-[var(--text)]">
                  <span v-if="hasSpriteFlag(room.home)" :class="['mobile-room-flag', flagClass(room.home)]" :aria-label="`${room.home.name} flag`"></span>
                  <span v-else class="mobile-room-flag flag-fallback flag-fallback-inline" :aria-label="`${room.home.name} flag`">{{ room.home.flag || room.home.code }}</span>
                  <span>{{ room.home.code }}</span>
                  <span class="ref-versus justify-self-center">v</span>
                  <span v-if="hasSpriteFlag(room.away)" :class="['mobile-room-flag', flagClass(room.away)]" :aria-label="`${room.away.name} flag`"></span>
                  <span v-else class="mobile-room-flag flag-fallback flag-fallback-inline" :aria-label="`${room.away.name} flag`">{{ room.away.flag || room.away.code }}</span>
                  <span>{{ room.away.code }}</span>
                </span>
              </span>

              <span
                class="inline-flex min-h-8 min-w-[58px] items-center justify-center justify-self-end rounded-md border px-2 text-[10px] font-black uppercase leading-none"
                :class="roomStatusClass(room)"
                :aria-label="roomStatusLabel(room)"
              >
                <span v-if="showsLiveRoomIcon(room)" class="inline-flex items-center gap-1.5">
                  <span class="live-pulse-dot h-2 w-2 rounded-full bg-current" aria-hidden="true"></span>
                  <span>{{ mobileRoomStatusText(room) }}</span>
                </span>
                <span v-else>{{ mobileRoomStatusText(room) }}</span>
              </span>
            </button>
          </div>
        </section>

        <section class="grid gap-[18px] max-md:gap-3" aria-label="Prediction feed">
          <div class="my-1 flex items-center justify-between gap-3 max-sm:flex-wrap">
            <h2 class="m-0 min-w-0 text-[18px] font-[760] leading-tight text-[var(--text)]">
              Prediction feed
              <span class="mx-1.5 text-[var(--muted)]">·</span>
              <span class="text-[15px] font-medium text-[var(--muted)]">Sorted by room energy</span>
            </h2>
            <button
              class="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg border border-[color:color-mix(in_srgb,var(--line)_78%,transparent)] bg-[color:color-mix(in_srgb,var(--chip-bg)_84%,transparent)] px-3 text-[13px] font-[760] text-[var(--soft)] shadow-[0_1px_0_color-mix(in_srgb,var(--text)_5%,transparent)] transition-[background-color,border-color,color,opacity,transform] duration-150 ease-[var(--ease)] hover:border-[color:color-mix(in_srgb,var(--accent)_24%,var(--line))] hover:bg-[color:color-mix(in_srgb,var(--accent)_6%,var(--chip-bg))] hover:text-[var(--text)] active:translate-y-px disabled:cursor-not-allowed disabled:border-[var(--line)] disabled:bg-[color:color-mix(in_srgb,var(--chip-bg)_44%,transparent)] disabled:text-[var(--muted)] disabled:opacity-50 disabled:shadow-none disabled:hover:bg-[color:color-mix(in_srgb,var(--chip-bg)_44%,transparent)] disabled:active:translate-y-0 md:min-h-9"
              type="button"
              :aria-label="nextFeedSortLabel"
              :aria-pressed="feedSortMode === 'comments'"
              :disabled="!canSortPredictions"
              @click="toggleFeedSort"
            >
              <svg class="ph-icon h-4 w-4" :class="canSortPredictions ? 'text-[var(--accent)]' : 'text-[var(--muted)]'" viewBox="0 0 256 256" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="18">
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
                <span :key="feedSortMode">{{ feedSortLabel }}</span>
              </Transition>
            </button>
          </div>

          <div
            v-if="!sortedPredictions.length"
            class="grid justify-items-center gap-3 rounded-xl border border-[var(--line)] bg-[color:color-mix(in_srgb,var(--panel)_88%,transparent)] p-5 text-center shadow-[var(--card-shadow)] max-md:rounded-[10px] max-md:p-4"
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
              class="inline-flex min-h-11 items-center justify-center rounded-lg bg-[var(--accent)] px-4 text-sm font-extrabold text-[var(--accent-text)] transition-[background-color,transform] duration-100 ease-[cubic-bezier(0.4,0,0.2,1)] hover:bg-[color:color-mix(in_srgb,var(--accent)_86%,black)] active:translate-y-px"
              type="button"
              @click="openPredictionModal"
            >
              Drop your score
            </button>
          </div>

          <Transition v-else name="room-feed" mode="out-in">
            <TransitionGroup :key="activeRoom.id" name="prediction-list" tag="div" class="grid gap-2.5 max-md:gap-3">
              <article
                v-for="item in sortedPredictions"
                :key="item.id"
                class="prediction relative grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3 overflow-visible rounded-xl border border-[var(--line)] bg-[color:color-mix(in_srgb,var(--panel)_88%,transparent)] p-4 shadow-[var(--card-shadow)] transition-[background-color,border-color,box-shadow] duration-300 ease-[var(--ease)] max-md:rounded-[10px] max-md:p-3.5"
                :class="leadComment(item) && (isReplying(item.id, leadComment(item)!.id) || isCommentsExpanded(item.id)) ? 'border-[color:color-mix(in_srgb,var(--accent)_30%,var(--line))] bg-[color:color-mix(in_srgb,var(--accent)_4%,var(--panel))] shadow-[0_14px_36px_rgba(42,37,32,0.10)]' : ''"
              >
              <div class="pt-0.5">
                <img class="prediction-avatar" :src="predictionAvatar(item.name)" :alt="`${item.name} avatar`" loading="lazy" decoding="async" />
              </div>

              <div class="grid min-w-0 gap-2">
                <div class="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
                  <h3 class="m-0 text-[15px] font-bold leading-tight">{{ item.name }}</h3>
                  <span class="inline-flex items-baseline gap-1.5 text-[13px] font-bold leading-tight text-[var(--muted)]">
                    <strong class="text-[18px] font-[850] text-[var(--text)]">{{ item.homeScore }}-{{ item.awayScore }}</strong>
                    <span class="uppercase tracking-[0.02em]">{{ activeRoom.home.code }} vs {{ activeRoom.away.code }}</span>
                  </span>
                </div>

                <div v-if="leadComment(item)">
                  <p data-lead-comment class="m-0 max-w-[62ch] text-[17px] leading-[1.4] text-[var(--soft)] max-md:text-base">{{ leadComment(item)?.text }}</p>
                </div>

                <div v-if="leadComment(item)?.replies.length" data-reply-thread class="grid gap-2 pt-1 pl-3">
                  <TransitionGroup
                    :name="isFastCollapsingComments(item.id) ? 'reply-row-fast' : 'reply-row'"
                    tag="div"
                    class="relative grid gap-1.5 border-l border-[color:color-mix(in_srgb,var(--accent)_34%,var(--line))] pl-3"
                    :class="shouldFadeCommentPreview(item) ? 'after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-8 after:bg-gradient-to-b after:from-transparent after:to-[var(--panel)]' : ''"
                  >
                    <div
                      v-for="(reply, replyIndex) in visibleReplies(item)"
                      :key="reply.id"
                      class="reply-row text-xs leading-[1.45] text-[var(--muted)]"
                      :style="{ '--reply-index': replyIndex }"
                    >
                      <strong>{{ reply.name }}:</strong> {{ reply.text }}
                    </div>
                  </TransitionGroup>
                  <button
                    v-if="shouldShowCommentToggle(item)"
                    class="ml-3 inline-flex w-fit items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[9px] font-[600] leading-tight text-[color:color-mix(in_srgb,var(--accent)_62%,var(--muted))] transition-[background-color,color,transform] duration-100 ease-[cubic-bezier(0.4,0,0.2,1)] hover:bg-[color:color-mix(in_srgb,var(--accent)_6%,transparent)] hover:text-[color:color-mix(in_srgb,var(--accent)_78%,var(--muted))] active:translate-y-px"
                    type="button"
                    :aria-expanded="String(isCommentsExpanded(item.id))"
                    @click="toggleComments(item.id)"
                  >
                    <span>{{ isCommentsExpanded(item.id) ? 'Show less' : `Show ${hiddenReplyCount(item)} more` }}</span>
                  </button>
                </div>

                <Transition name="reply-composer" @after-enter="focusReplyComposer">
                  <form
                    v-if="leadComment(item) && isReplying(item.id, leadComment(item)!.id)"
                    data-reply-composer
                    class="mt-1 grid grid-cols-[minmax(0,1fr)_auto] gap-2 max-md:grid-cols-1"
                    @submit.prevent="submitReply(leadComment(item)!.id)"
                  >
                    <input
                      :data-reply-key="leadComment(item)!.id"
                      v-model="replyDrafts[leadComment(item)!.id]"
                      class="min-h-9 w-full rounded-lg border border-[var(--control-border)] bg-[var(--control-bg)] px-2.5 text-sm text-[var(--text)] outline-none disabled:cursor-wait disabled:opacity-70"
                      aria-label="Reply"
                      placeholder="Keep it light..."
                      :disabled="isReplySubmitting(leadComment(item)!.id)"
                    />
                    <button
                      class="inline-flex min-h-9 items-center justify-center rounded-lg bg-[var(--accent)] px-3 text-xs font-extrabold text-[var(--accent-text)] transition-[background-color,opacity,transform] duration-100 ease-[cubic-bezier(0.4,0,0.2,1)] hover:bg-[color:color-mix(in_srgb,var(--accent)_86%,black)] active:translate-y-px disabled:cursor-wait disabled:opacity-65 disabled:active:translate-y-0"
                      type="submit"
                      :disabled="!canSubmitReply(leadComment(item)!.id)"
                    >
                      <span>{{ isReplySubmitting(leadComment(item)!.id) ? 'Sending' : 'Reply' }}</span>
                    </button>
                    <p
                      v-if="replyErrors[leadComment(item)!.id]"
                      class="col-span-full m-0 text-xs font-semibold text-[color:color-mix(in_srgb,#d14343_78%,var(--text))]"
                    >
                      {{ replyErrors[leadComment(item)!.id] }}
                    </p>
                  </form>
                </Transition>
              </div>

              <div class="grid w-[54px] flex-none content-start gap-1.5 justify-self-end max-md:w-auto max-md:gap-1">
                <button
                  class="group inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-md border border-transparent bg-transparent px-1.5 text-[12px] font-[720] text-[var(--muted)] transition-[border-color,background-color,color,transform] duration-100 ease-[cubic-bezier(0.4,0,0.2,1)] hover:border-[color:color-mix(in_srgb,var(--accent)_16%,transparent)] hover:bg-[color:color-mix(in_srgb,var(--accent)_7%,transparent)] hover:text-[color:color-mix(in_srgb,var(--accent)_70%,var(--muted))] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-[0.55] disabled:active:translate-y-0 md:min-h-8 md:min-w-[54px]"
                  :class="likedPredictions.has(item.id) ? 'text-[var(--accent)]' : ''"
                  type="button"
                  :aria-label="`Like prediction from ${item.name}`"
                  @click="submitLike(item.id, item.authorId)"
                >
                  <svg class="ph-icon h-5 w-5" :class="likedPredictions.has(item.id) ? 'reaction-pop fill-current text-[var(--accent)]' : ''" viewBox="0 0 256 256" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="18">
                    <path d="M128 216S28 160 28 92a52 52 0 0 1 92-33.2L128 68l8-9.2A52 52 0 0 1 228 92c0 68-100 124-100 124Z"></path>
                  </svg>
                  <span :key="item.likes" class="reaction-count [font-variant-numeric:tabular-nums]">{{ item.likes }}</span>
                </button>

                <button
                  class="inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-md border border-transparent bg-transparent px-1.5 text-[12px] font-[720] text-[var(--muted)] transition-[border-color,background-color,color,transform] duration-100 ease-[cubic-bezier(0.4,0,0.2,1)] hover:border-[var(--line)] hover:bg-[color:color-mix(in_srgb,var(--accent)_6%,var(--chip-bg))] hover:text-[var(--accent)] active:translate-y-px md:min-h-8 md:min-w-[54px]"
                  :class="leadComment(item) && isReplying(item.id, leadComment(item)!.id) ? 'border-[color:color-mix(in_srgb,var(--accent)_24%,var(--line))] bg-[color:color-mix(in_srgb,var(--accent)_9%,var(--chip-bg))] text-[var(--accent)]' : ''"
                  type="button"
                  :aria-expanded="leadComment(item) ? String(isReplying(item.id, leadComment(item)!.id)) : 'false'"
                  :aria-label="`Reply to ${item.name}. ${predictionCommentTotal(item)} comments and replies`"
                  @click="leadComment(item) && toggleReply(item.id, leadComment(item)!.id)"
                >
                  <svg class="ph-icon h-5 w-5" viewBox="0 0 256 256" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="18">
                    <path d="M45.2 188.7A88 88 0 1 1 76 219.5L36 228Z"></path>
                  </svg>
                  <span :key="predictionCommentTotal(item)" class="reaction-count [font-variant-numeric:tabular-nums]">{{ predictionCommentTotal(item) }}</span>
                </button>
              </div>
              </article>
            </TransitionGroup>
          </Transition>
        </section>
      </div>

      <aside class="grid gap-3 min-[981px]:sticky min-[981px]:top-4 max-md:hidden">
        <section class="overflow-hidden rounded-xl border border-[var(--line)] bg-[color:color-mix(in_srgb,var(--panel)_88%,transparent)] p-[18px] shadow-[var(--card-shadow)] max-md:rounded-[10px]">
          <div class="relative grid gap-[14px] pt-[22px] max-md:pt-[18px]" :aria-label="`Most backed score: ${activeRoom.home.name} ${activeRoom.mostBacked.home}, ${activeRoom.away.name} ${activeRoom.mostBacked.away}`">
            <span class="absolute right-[-54px] top-[22px] z-20 inline-flex h-7 w-[184px] origin-center rotate-45 items-center justify-center border-y border-y-[color:color-mix(in_srgb,var(--accent)_42%,var(--line))] bg-[color:color-mix(in_srgb,var(--accent)_14%,var(--panel))] px-3 text-center text-[10px] font-extrabold uppercase leading-none tracking-[0.08em] text-[color:color-mix(in_srgb,var(--accent)_88%,var(--text))] max-md:right-[-52px] max-md:top-[19px] max-md:h-6 max-md:w-[164px] max-md:text-[9px]">Top pick</span>
            <div class="text-xs font-extrabold uppercase text-[var(--muted)]">Most-backed score</div>
            <div class="grid grid-cols-[auto_auto_auto] items-center justify-center justify-items-center gap-[clamp(14px,3vw,28px)] py-3 pt-3 pb-2.5">
              <div class="grid justify-items-center gap-[7px]">
                <span v-if="hasSpriteFlag(activeRoom.home)" :class="flagClass(activeRoom.home)" aria-hidden="true"></span>
                <span v-else class="flag flag-fallback flag-fallback-small" aria-hidden="true">{{ activeRoom.home.flag || activeRoom.home.code }}</span>
                <span class="text-xs font-extrabold uppercase text-[var(--muted)]">{{ activeRoom.home.code }}</span>
              </div>

              <div class="inline-flex items-center gap-2.5 [font-variant-numeric:tabular-nums]">
                <div class="text-[clamp(58px,8vw,78px)] leading-[0.86] font-black text-[var(--text)]">{{ activeRoom.mostBacked.home }}</div>
                <div class="text-2xl font-black text-[var(--accent)]">-</div>
                <div class="text-[clamp(58px,8vw,78px)] leading-[0.86] font-black text-[var(--text)]">{{ activeRoom.mostBacked.away }}</div>
              </div>

              <div class="grid justify-items-center gap-[7px]">
                <span v-if="hasSpriteFlag(activeRoom.away)" :class="flagClass(activeRoom.away)" aria-hidden="true"></span>
                <span v-else class="flag flag-fallback flag-fallback-small" aria-hidden="true">{{ activeRoom.away.flag || activeRoom.away.code }}</span>
                <span class="text-xs font-extrabold uppercase text-[var(--muted)]">{{ activeRoom.away.code }}</span>
              </div>

              <div class="col-span-full text-xs font-[650] text-[var(--muted)]">{{ activeRoom.mostBacked.margin }}</div>
            </div>

            <div class="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 border-t border-t-[rgba(229,229,229,0.08)] px-1 pt-3">
              <span class="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-xs font-extrabold uppercase text-[var(--muted)]">{{ activeRoom.home.name }}</span>
              <span class="text-xs font-extrabold uppercase text-[var(--muted)]">vs</span>
              <span class="min-w-0 overflow-hidden text-right text-ellipsis whitespace-nowrap text-xs font-extrabold uppercase text-[var(--muted)]">{{ activeRoom.away.name }}</span>
            </div>

            <button class="inline-flex min-h-11 items-center justify-center rounded-lg bg-[var(--accent)] px-[14px] text-[13px] font-extrabold text-[var(--accent-text)] transition-[background-color,transform] duration-100 ease-[cubic-bezier(0.4,0,0.2,1)] hover:bg-[color:color-mix(in_srgb,var(--accent)_86%,black)] active:translate-y-px" type="button" @click="openPredictionModal">Drop your score</button>
          </div>
        </section>

        <section class="grid gap-[14px] rounded-xl border border-[var(--line)] bg-[color:color-mix(in_srgb,var(--panel)_88%,transparent)] p-4 shadow-[var(--card-shadow)] max-md:rounded-[10px]">
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

          <div v-if="roomPageCount > 1" class="flex items-center justify-between border-t border-[var(--line)] pt-2">
            <button
              class="inline-grid h-8 w-8 place-items-center rounded-md text-[var(--muted)] transition-[background-color,color,transform] duration-100 ease-[cubic-bezier(0.4,0,0.2,1)] hover:bg-[var(--chip-bg)] hover:text-[var(--accent)] active:translate-y-px disabled:pointer-events-none disabled:opacity-35"
              type="button"
              aria-label="Previous rooms"
              :disabled="roomPage === 0"
              @click="previousRoomPage"
            >
              <svg class="ph-icon h-4 w-4" viewBox="0 0 256 256" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="22">
                <path d="M160 48 80 128l80 80"></path>
              </svg>
            </button>
            <span class="text-[11px] font-bold text-[var(--muted)]">{{ roomPageLabel }}</span>
            <button
              class="inline-grid h-8 w-8 place-items-center rounded-md text-[var(--muted)] transition-[background-color,color,transform] duration-100 ease-[cubic-bezier(0.4,0,0.2,1)] hover:bg-[var(--chip-bg)] hover:text-[var(--accent)] active:translate-y-px disabled:pointer-events-none disabled:opacity-35"
              type="button"
              aria-label="Next rooms"
              :disabled="roomPage >= roomPageCount - 1"
              @click="nextRoomPage"
            >
              <svg class="ph-icon h-4 w-4" viewBox="0 0 256 256" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="22">
                <path d="m96 48 80 80-80 80"></path>
              </svg>
            </button>
          </div>

          <form class="grid gap-2 pt-1" @submit.prevent="saveUsername">
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
                class="inline-flex h-11 min-w-[82px] flex-none items-center justify-center gap-1.5 rounded-lg border border-[color:color-mix(in_srgb,var(--accent)_30%,var(--control-border))] bg-[color:color-mix(in_srgb,var(--accent)_6%,var(--control-bg))] px-3.5 text-sm font-[750] leading-none text-[var(--accent)] shadow-[0_1px_0_color-mix(in_srgb,var(--text)_5%,transparent),inset_0_1px_0_rgba(255,255,255,0.16)] transition-[border-color,background-color,color,box-shadow,opacity,transform] duration-150 ease-[var(--ease)] hover:border-[color:color-mix(in_srgb,var(--accent)_44%,var(--control-border))] hover:bg-[color:color-mix(in_srgb,var(--accent)_10%,var(--control-bg))] active:translate-y-px disabled:pointer-events-none disabled:cursor-not-allowed disabled:border-[var(--line)] disabled:bg-[color:color-mix(in_srgb,var(--control-bg)_76%,var(--panel))] disabled:text-[var(--muted)] disabled:opacity-[0.58] disabled:shadow-none disabled:active:translate-y-0"
                type="submit"
                :disabled="!canSaveUsername"
                :aria-label="canSaveUsername ? 'Save username' : 'Enter username to save'"
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
                <span>Save</span>
              </button>
            </div>
            <p
              class="flex min-h-0 items-center justify-between gap-2 text-[11px] leading-tight"
              :class="usernameError ? 'text-[var(--danger)]' : 'text-[var(--muted)]'"
            >
              <span>{{ usernameError || (username ? 'Saved locally for this browser' : '') }}</span>
              <button
                v-if="username"
                class="text-[11px] font-bold text-[var(--accent)] transition-[color,transform] duration-100 ease-[cubic-bezier(0.4,0,0.2,1)] hover:text-[color:color-mix(in_srgb,var(--accent)_78%,black)] active:translate-y-px"
                type="button"
                @click="resetUsername"
              >Reset</button>
            </p>
          </form>
        </section>
      </aside>
    </section>

    <Transition name="sheet-flow">
      <div v-if="identityPromptOpen" class="sheet-overlay fixed inset-0 z-[1300] grid items-end bg-black/50 p-[env(safe-area-inset-top)_env(safe-area-inset-right)_env(safe-area-inset-bottom)_env(safe-area-inset-left)]" aria-hidden="false" @click.self="closeIdentityPrompt">
      <section class="sheet-panel mx-auto mb-[max(10px,env(safe-area-inset-bottom))] flex max-h-[min(86dvh,calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom)-18px))] w-[min(760px,calc(100%-20px))] flex-col overflow-auto rounded-xl border border-[var(--line-strong)] bg-[var(--panel)] p-[18px] shadow-[var(--card-shadow)]" role="dialog" aria-modal="true" aria-labelledby="identity-title">
        <div class="sheet-stagger mb-4 flex items-center justify-between gap-3" style="--sheet-index: 0">
          <div>
            <h2 id="identity-title" class="m-0 text-xl font-extrabold leading-tight text-[var(--text)]">Pick your room name</h2>
            <p class="m-0 text-[13px] leading-snug text-[var(--muted)]">Set once for this browser. Used for comments and likes.</p>
          </div>
          <button class="inline-flex h-11 min-h-11 w-11 min-w-11 flex-none items-center justify-center rounded-lg bg-white/[0.06] p-0 text-[var(--text)] transition-[background-color,transform] duration-100 ease-[cubic-bezier(0.4,0,0.2,1)] hover:bg-white/[0.1] active:translate-y-px" type="button" aria-label="Set username later" @click="closeIdentityPrompt">
            <svg class="ph-icon h-5 w-5" viewBox="0 0 256 256" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="18">
              <path d="M200 56 56 200"></path>
              <path d="M56 56l144 144"></path>
            </svg>
          </button>
        </div>

        <form class="sheet-stagger mt-3 grid gap-2.5 rounded-lg border border-[var(--line)] bg-[var(--card-soft)] p-3" style="--sheet-index: 1" @submit.prevent="saveUsername">
          <label class="text-[11px] font-extrabold uppercase text-[var(--muted)]" for="prompt-username">Username</label>
          <div class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
            <input
              id="prompt-username"
              ref="identityPromptInput"
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
              :disabled="!canSaveUsername"
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
          <p id="identity-prompt-error" class="m-0 min-h-[14px] text-xs leading-[1.4] text-[var(--danger)]" role="status" aria-live="polite">{{ usernameError || identityPromptMessage }}</p>
        </form>
      </section>
      </div>
    </Transition>

    <Transition name="sheet-flow">
      <div v-if="predictionModalOpen && activeRoom" class="sheet-overlay fixed inset-0 z-[1200] grid items-end bg-black/50 p-[env(safe-area-inset-top)_env(safe-area-inset-right)_env(safe-area-inset-bottom)_env(safe-area-inset-left)]" aria-hidden="false" @click.self="submittingPrediction ? undefined : closePredictionModal()">
      <section class="sheet-panel mx-auto mb-[max(10px,env(safe-area-inset-bottom))] flex h-fit max-h-[min(86dvh,calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom)-18px))] w-[min(760px,calc(100%-20px))] flex-col overflow-auto rounded-xl border border-[var(--line-strong)] bg-[var(--panel)] p-[18px] shadow-[var(--card-shadow)]" role="dialog" aria-modal="true" :aria-labelledby="`sheet-title-${activeRoom.id}`">
        <div class="sheet-stagger mb-3 flex items-start justify-between gap-3" style="--sheet-index: 0">
          <h2 class="m-0 text-xl font-extrabold leading-tight max-md:text-[18px]" :id="`sheet-title-${activeRoom.id}`">Your {{ activeRoom.home.name }} vs {{ activeRoom.away.name }} score</h2>
          <button class="inline-flex min-h-10 w-10 min-w-10 items-center justify-center rounded-lg border border-[var(--line)] bg-[var(--chip-bg)] p-0 text-[var(--muted)] transition-[background-color,border-color,transform] duration-100 ease-[cubic-bezier(0.4,0,0.2,1)] hover:border-[color:color-mix(in_srgb,var(--line)_82%,black)] hover:bg-[color:color-mix(in_srgb,var(--chip-bg)_88%,black)] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50 disabled:active:translate-y-0" type="button" aria-label="Close" :disabled="submittingPrediction" @click="closePredictionModal">
            <svg class="ph-icon h-5 w-5" viewBox="0 0 256 256" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="18">
              <path d="M200 56 56 200"></path>
              <path d="M56 56l144 144"></path>
            </svg>
          </button>
        </div>

        <form class="sheet-stagger" style="--sheet-index: 1" :aria-busy="submittingPrediction" @submit.prevent="submitPrediction">
          <div class="grid grid-cols-2 gap-2.5 max-md:grid-cols-1">
            <div class="grid gap-1.5">
              <label class="text-xs font-bold text-[var(--muted)]" for="home-score">{{ activeRoom.home.name }}</label>
              <input id="home-score" v-model.number="predictionForm.homeScore" class="min-h-10 w-full rounded-lg border border-[var(--control-border)] bg-[var(--control-bg)] px-[11px] text-[var(--text)] outline-none disabled:cursor-not-allowed disabled:opacity-60 md:min-h-11" type="number" min="0" max="20" :disabled="submittingPrediction" required />
            </div>
            <div class="grid gap-1.5">
              <label class="text-xs font-bold text-[var(--muted)]" for="away-score">{{ activeRoom.away.name }}</label>
              <input id="away-score" v-model.number="predictionForm.awayScore" class="min-h-10 w-full rounded-lg border border-[var(--control-border)] bg-[var(--control-bg)] px-[11px] text-[var(--text)] outline-none disabled:cursor-not-allowed disabled:opacity-60 md:min-h-11" type="number" min="0" max="20" :disabled="submittingPrediction" required />
            </div>
          </div>

          <div class="mt-2.5 grid gap-2">
            <div class="grid gap-1.5">
              <label class="text-xs font-bold text-[var(--muted)]" for="take">Comment</label>
              <textarea id="take" v-model="predictionForm.comment" class="max-h-20 min-h-16 w-full resize-none overflow-y-auto rounded-lg border border-[var(--control-border)] bg-[var(--control-bg)] px-3 py-2.5 text-[var(--text)] outline-none disabled:cursor-not-allowed disabled:opacity-60 max-md:min-h-14" rows="2" placeholder="Add a little confidence..." :disabled="submittingPrediction"></textarea>
            </div>
            <button class="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-[var(--accent)] px-[14px] text-[13px] font-extrabold text-[var(--accent-text)] transition-[background-color,transform,opacity] duration-100 ease-[cubic-bezier(0.4,0,0.2,1)] hover:bg-[color:color-mix(in_srgb,var(--accent)_86%,black)] active:translate-y-px disabled:cursor-wait disabled:opacity-80 disabled:active:translate-y-0 md:min-h-11" type="submit" :disabled="submittingPrediction">
              <svg v-if="submittingPrediction" class="h-4 w-4 animate-spin" viewBox="0 0 24 24" aria-hidden="true" fill="none">
                <circle class="opacity-30" cx="12" cy="12" r="9" stroke="currentColor" stroke-width="3"></circle>
                <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" stroke-linecap="round" stroke-width="3"></path>
              </svg>
              <span>{{ submittingPrediction ? 'Posting...' : 'Post prediction' }}</span>
            </button>
          </div>
        </form>
      </section>
      </div>
    </Transition>
  </main>
</template>
