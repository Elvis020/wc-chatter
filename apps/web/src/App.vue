<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { compareRoomsForSwitcher as compareRoomsForSwitcherByState, effectiveRoomMatchStatus as effectiveRoomMatchStatusByState, isRoomLocked as isRoomLockedByState, loadFixtures, matchKickoffUtc, mockThemes, roomKickoffMs as roomKickoffMsByState, roomKickoffTime as roomKickoffTimeByState, subdivisionFlagIso2, type ApiEvent, type CreatePredictionInput, type Prediction, type Reply, type ReplyInput, type Room, type Team, type ThemeId, type TypingEvent, type TypingTarget } from '@wc-chatter/shared'
import 'flag-icons/css/flag-icons.min.css'
import { connectRoomEvents, createPrediction, createReply, fetchBootstrap, togglePredictionLike, updatePredictionText, updateReply } from './lib/api'
import IdentityPrompt from './components/IdentityPrompt.vue'
import ScoreDrawer from './components/ScoreDrawer.vue'
import { createNaviiIcon } from './lib/navii'
import {
  getOrCreateUserId,
  getStoredActiveRoomId,
  getStoredLikes,
  getStoredPredictionDrafts,
  getStoredReplyDrafts,
  getStoredTheme,
  getStoredUsername,
  setStoredActiveRoomId,
  setStoredUsername,
  setStoredLikes,
  setStoredPredictionDrafts,
  setStoredReplyDrafts,
  setStoredTheme,
} from './lib/storage'

const USERNAME_PATTERN = /^[A-Za-zÀ-ÖØ-öø-ÿ0-9 .'-]{2,24}$/
const MIN_PREDICTION_COMMENT_LENGTH = 4
const COMMENT_PREVIEW_LIMIT = 3
const ROOM_PAGE_SIZE = 4
const ROOM_REFRESH_MS = 60_000
const TYPING_IDLE_MS = 1800
const TYPING_THROTTLE_MS = 1400
const TYPING_VISIBLE_MS = 3200
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
type TypingState = {
  userId: string
  name: string
  target: TypingTarget
  targetId: string
  expiresAt: number
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
const usernameError = ref('')
const rooms = ref<Room[]>([])
const activeRoomId = ref(getStoredActiveRoomId())
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
const themePreview = ref<ThemeId | null>(null)
const feedSortMode = ref<FeedSortMode>('likes')
const roomPage = ref(0)
const likedPredictions = ref(getStoredLikes())
const activeReplyTarget = ref<{ predictionId: string; commentId: string } | null>(null)
const expandedCommentCards = ref(new Set<string>())
const fastCollapsingCommentCards = ref(new Set<string>())
const pendingIdentityAction = ref<PendingIdentityAction | null>(null)
const themeTrigger = ref<HTMLElement | null>(null)
const identityPrompt = ref<InstanceType<typeof IdentityPrompt> | null>(null)
const predictionFeed = ref<HTMLElement | null>(null)
const predictionFeedList = ref<HTMLElement | null>(null)
const themeMenuStyle = ref<Record<string, string>>({})
const ws = ref<WebSocket | null>(null)
const submittingReplies = ref(new Set<string>())
const submittingEdits = ref(new Set<string>())
const editingPredictionId = ref('')
const editingReplyId = ref('')
const replyErrors = reactive<Record<string, string>>({})
const editDrafts = reactive<Record<string, string>>({})
const editErrors = reactive<Record<string, string>>({})
const updatedRoomIds = ref(new Set<string>())
const updatedPredictionIds = ref(new Set<string>())
const typingPeople = ref(new Map<string, TypingState>())
const feedNavMode = ref<'hidden' | 'up' | 'down'>('hidden')
let identityPromptTimer: ReturnType<typeof window.setTimeout> | null = null
let mutationErrorTimer: ReturnType<typeof window.setTimeout> | null = null
let reconnectTimer: ReturnType<typeof window.setTimeout> | null = null
let roomRefreshTimer: ReturnType<typeof window.setInterval> | null = null
let fastCommentCollapseTimer: ReturnType<typeof window.setTimeout> | null = null
let replyFocusTimers: ReturnType<typeof window.setTimeout>[] = []
let livePulseTimer: ReturnType<typeof window.setTimeout> | null = null
let typingCleanupTimer: ReturnType<typeof window.setTimeout> | null = null
let reconnectAttempt = 0
let socketToken = 0
let roomsRefreshInFlight = false
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
const canSaveUsername = computed(() => !username.value && usernameDraft.value.trim().length > 0)
const canSortPredictions = computed(() => (activeRoom.value?.predictions.length ?? 0) > 0)
const activeRoomPredictionsClosed = computed(() => !!activeRoom.value && isRoomLockedByState(activeRoom.value, { fixtureKickoffs }))
const canSubmitPrediction = computed(() => !activeRoomPredictionsClosed.value && predictionForm.comment.trim().length >= MIN_PREDICTION_COMMENT_LENGTH)
const userPrediction = computed(() => activeRoom.value?.predictions.find((prediction) => prediction.authorId === userId) ?? null)
const hasUserPredicted = computed(() => !!userPrediction.value)
const scoreCtaLabel = computed(() => {
  if (activeRoomPredictionsClosed.value) return 'Predictions closed'
  return hasUserPredicted.value ? 'Already predicted' : 'Drop your score'
})
const scoreCtaDisabled = computed(() => hasUserPredicted.value || activeRoomPredictionsClosed.value)
const isNotFound = computed(() => routePath.value !== '/')
const orderedRooms = computed(() =>
  [...rooms.value].sort((left, right) => compareRoomsForSwitcherByState(left, right, { fixtureKickoffs })),
)
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
const effectiveTheme = computed(() => themePreview.value ?? selectedTheme.value)

watch(effectiveTheme, (value) => {
  document.body.dataset.theme = value === 'paper' ? '' : value
  updateFavicon(value)
}, { immediate: true })

watch(selectedTheme, (value) => {
  setStoredTheme(value)
})

watch(activeRoom, (room) => {
  if (!room) return
  predictionForm.homeScore = room.mostBacked.home
  predictionForm.awayScore = room.mostBacked.away
  predictionForm.comment = predictionDrafts[room.id] ?? ''
})

watch(activeRoomId, (roomId) => {
  if (roomId) setStoredActiveRoomId(roomId)
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
  nextTick(() => identityPrompt.value?.focus())
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
  if (scoreCtaDisabled.value) return
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

function sortedReplies(prediction: Prediction) {
  return [...(leadComment(prediction)?.replies ?? [])].sort(
    (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
  )
}

function showsFullThread(prediction: Prediction) {
  return isCommentsExpanded(prediction.id)
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

function roomKickoffMs(room: Room) {
  return roomKickoffMsByState(room, fixtureKickoffs)
}

function effectiveRoomMatchStatus(room: Room) {
  return effectiveRoomMatchStatusByState(room, { fixtureKickoffs })
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

function isReplying(predictionId: string, commentId: string) {
  return (
    activeReplyTarget.value?.predictionId === predictionId &&
    activeReplyTarget.value?.commentId === commentId
  )
}

function isReplySubmitting(commentId: string) {
  return submittingReplies.value.has(commentId)
}

function isEditSubmitting(contentId: string) {
  return submittingEdits.value.has(contentId)
}

function canSubmitReply(commentId: string) {
  return !isReplySubmitting(commentId) && !!(replyDrafts[commentId] || '').trim()
}

function hasReplyDraft(commentId: string) {
  return !!(replyDrafts[commentId] || '').trim()
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

function canEditPrediction(prediction: Prediction) {
  return prediction.authorId === userId && roomAllowsTextEditing() && !prediction.id.startsWith('optimistic-')
}

function canEditReply(reply: Reply) {
  return reply.authorId === userId && roomAllowsTextEditing() && !reply.id.startsWith('optimistic-')
}

function canSubmitEdit(contentId: string, minLength = 1) {
  return !isEditSubmitting(contentId) && (editDrafts[contentId] || '').trim().length >= minLength
}

function setActiveRoom(roomId: string) {
  activeRoomId.value = roomId
  activeReplyTarget.value = null
  expandedCommentCards.value = new Set()
  fastCollapsingCommentCards.value = new Set()
  editingPredictionId.value = ''
  editingReplyId.value = ''
  clearTypingState()
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
    comment: submittedComment,
  }
  const optimisticPrediction: Prediction = {
    id: `optimistic-prediction-${roomId}-${Date.now()}`,
    authorId: userId,
    name: username.value,
    homeScore: predictionForm.homeScore,
    awayScore: predictionForm.awayScore,
    likes: 0,
    createdAt: new Date().toISOString(),
    comments: [
      {
        id: `optimistic-comment-${roomId}-${Date.now()}`,
        authorId: userId,
        text: submittedComment || 'Fresh from the confidence department.',
        replies: [],
      },
    ],
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

function openReplyComposer(predictionId: string, commentId: string) {
  fastCollapsingCommentCards.value = new Set()
  editingPredictionId.value = ''
  editingReplyId.value = ''
  activeReplyTarget.value = { predictionId, commentId }
  nextTick(() => {
    focusReplyInput(commentId)
  })
}

function closeReplyComposer(commentId: string) {
  stopTyping('reply', commentId)
  activeReplyTarget.value = null
}

function startEditingPrediction(prediction: Prediction) {
  const comment = leadComment(prediction)
  if (!comment || !canEditPrediction(prediction)) return
  activeReplyTarget.value = null
  editingReplyId.value = ''
  editingPredictionId.value = prediction.id
  editDrafts[prediction.id] = comment.text
  editErrors[prediction.id] = ''
  nextTick(() => focusEditInput(prediction.id))
}

function startEditingReply(reply: Reply) {
  if (!canEditReply(reply)) return
  activeReplyTarget.value = null
  editingPredictionId.value = ''
  editingReplyId.value = reply.id
  editDrafts[reply.id] = reply.text
  editErrors[reply.id] = ''
  nextTick(() => focusEditInput(reply.id))
}

function cancelEdit(contentId: string) {
  if (editingPredictionId.value === contentId) editingPredictionId.value = ''
  if (editingReplyId.value === contentId) editingReplyId.value = ''
  editErrors[contentId] = ''
}

function focusEditInput(contentId: string) {
  const input = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[data-edit-key="${CSS.escape(contentId)}"]`)
  input?.focus()
  input?.select()
}

function toggleReply(predictionId: string, commentId: string) {
  if (!requireUsername('Set your username before replying.', { type: 'reply', predictionId, commentId })) return
  if (isReplying(predictionId, commentId)) {
    if (isMobileViewport()) {
      focusReplyInput(commentId)
      return
    }

    closeReplyComposer(commentId)
    return
  }

  openReplyComposer(predictionId, commentId)
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

function focusReplyInput(commentId: string) {
  const input = document.querySelector<HTMLInputElement>(`input[data-reply-key="${CSS.escape(commentId)}"]`)
  focusReplyElement(input)
}

function focusReplyComposer(element: Element) {
  focusReplyElement(element.querySelector<HTMLInputElement>('input[data-reply-key]'))
}

function isMobileViewport() {
  return window.matchMedia('(max-width: 767px)').matches
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
  const target =
    direction === 'up'
      ? predictionFeed.value
      : predictionFeedList.value?.lastElementChild

  target?.scrollIntoView({
    behavior: 'smooth',
    block: direction === 'up' ? 'start' : 'end',
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
  const optimisticReply: Reply = {
    id: `optimistic-reply-${commentId}-${Date.now()}`,
    authorId: userId,
    name: username.value,
    text,
    createdAt: new Date().toISOString(),
  }

  submittingReplies.value = new Set(submittingReplies.value).add(commentId)
  replyErrors[commentId] = ''
  replyDrafts[commentId] = ''
  stopTyping('reply', commentId)
  activeReplyTarget.value = null
  updateLocalReplyThread(commentId, (replies) => [...replies, optimisticReply])

  try {
    const response = await createReply(commentId, payload)
    patchRoom(response.room)
  } catch (error) {
    removeLocalReply(optimisticReply.id)
    replyDrafts[commentId] = text
    const predictionId = predictionIdForComment(commentId)
    activeReplyTarget.value = predictionId ? { predictionId, commentId } : null
    replyErrors[commentId] = errorText(error, 'Reply did not send. Try again.')
    showMutationError(replyErrors[commentId])
  } finally {
    const nextSubmitting = new Set(submittingReplies.value)
    nextSubmitting.delete(commentId)
    submittingReplies.value = nextSubmitting
  }
}

async function submitPredictionEdit(prediction: Prediction) {
  const text = (editDrafts[prediction.id] || '').trim()
  if (!text || text.length < MIN_PREDICTION_COMMENT_LENGTH || isEditSubmitting(prediction.id) || !canEditPrediction(prediction)) return

  const previousPrediction = structuredClone(prediction)
  const editedAt = new Date().toISOString()
  const nextSubmitting = new Set(submittingEdits.value)
  nextSubmitting.add(prediction.id)
  submittingEdits.value = nextSubmitting
  editErrors[prediction.id] = ''
  updateLocalPrediction(prediction.id, (item) => ({
    ...item,
    editedAt,
    comments: item.comments.map((comment, index) => index === 0 ? { ...comment, text, editedAt } : comment),
  }))

  try {
    const response = await updatePredictionText(prediction.id, { userId, comment: text })
    patchRoom(response.room)
    editingPredictionId.value = ''
  } catch (error) {
    updateLocalPrediction(prediction.id, () => previousPrediction)
    editingPredictionId.value = prediction.id
    editDrafts[prediction.id] = text
    editErrors[prediction.id] = errorText(error, 'Prediction edit did not save. Try again.')
    showMutationError(editErrors[prediction.id])
  } finally {
    const next = new Set(submittingEdits.value)
    next.delete(prediction.id)
    submittingEdits.value = next
  }
}

async function submitReplyEdit(reply: Reply) {
  const text = (editDrafts[reply.id] || '').trim()
  if (!text || isEditSubmitting(reply.id) || !canEditReply(reply)) return

  const previousReply = structuredClone(reply)
  const editedAt = new Date().toISOString()
  const nextSubmitting = new Set(submittingEdits.value)
  nextSubmitting.add(reply.id)
  submittingEdits.value = nextSubmitting
  editErrors[reply.id] = ''
  updateLocalReply(reply.id, (item) => ({ ...item, text, editedAt }))

  try {
    const response = await updateReply(reply.id, { userId, text })
    patchRoom(response.room)
    editingReplyId.value = ''
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
  if (themeMenuOpen.value) {
    nextTick(positionThemeMenu)
  }
}

function applyTheme(themeId: ThemeId) {
  selectedTheme.value = themeId
  themePreview.value = null
  themeMenuOpen.value = false
}

function previewTheme(themeId: ThemeId) {
  themePreview.value = themeId
}

function clearThemePreview() {
  themePreview.value = null
}

function handleGlobalClick(event: MouseEvent) {
  const target = event.target as HTMLElement | null
  if (!target?.closest('.ui-select')) {
    themeMenuOpen.value = false
    clearThemePreview()
  }
}

function handleRouteChange() {
  routePath.value = window.location.pathname
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
  window.addEventListener('resize', updateFeedNavMode)
  window.addEventListener('scroll', positionThemeMenu, { passive: true })
  window.addEventListener('scroll', updateFeedNavMode, { passive: true })
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
  if (livePulseTimer) {
    window.clearTimeout(livePulseTimer)
  }
  clearTypingState()
  clearReplyFocusTimers()
  socketToken += 1
  ws.value?.close()
  document.removeEventListener('click', handleGlobalClick)
  window.removeEventListener('popstate', handleRouteChange)
  window.removeEventListener('resize', positionThemeMenu)
  window.removeEventListener('resize', updateFeedNavMode)
  window.removeEventListener('scroll', positionThemeMenu)
  window.removeEventListener('scroll', updateFeedNavMode)
})
</script>

<template>
  <main class="mx-auto w-[min(1180px,calc(100%-32px))] px-0 pt-6 pb-[42px] max-md:w-[min(100%,calc(100%-24px))] max-md:pt-[18px] max-md:pb-[calc(96px+env(safe-area-inset-bottom))]">
    <header class="mb-[34px] flex items-center justify-between gap-4">
      <div class="flex items-center">
        <div class="inline-flex items-baseline gap-2 whitespace-nowrap text-[clamp(22px,2.2vw,30px)] leading-none font-black text-[var(--accent)]" aria-label="turntabl score room">turntabl <span class="font-[750] text-[var(--text)]">score room</span></div>
      </div>

      <div class="flex items-center gap-2">
        <div
          v-if="username"
          class="hidden min-h-10 max-w-[180px] items-center gap-2 rounded-lg border border-[color:color-mix(in_srgb,var(--accent)_18%,var(--line))] bg-[color:color-mix(in_srgb,var(--chip-bg)_70%,transparent)] px-2.5 text-[12px] font-bold text-[var(--text)] shadow-[0_1px_0_color-mix(in_srgb,var(--text)_5%,transparent)] sm:inline-flex"
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
            @mouseenter="previewTheme(theme.id)"
            @focus="previewTheme(theme.id)"
            @mouseleave="clearThemePreview"
            @blur="clearThemePreview"
            @click="applyTheme(theme.id)"
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
          class="hidden items-center justify-center gap-2 transition-[background-color,border-color,color,transform] duration-150 ease-[var(--ease)] active:translate-y-px disabled:cursor-default disabled:active:translate-y-0 max-md:inline-flex"
          :class="scoreCtaDisabled
            ? 'mx-auto min-h-9 w-fit rounded-full border border-[color:color-mix(in_srgb,var(--accent)_26%,var(--line))] bg-[color:color-mix(in_srgb,var(--panel)_82%,var(--accent)_8%)] px-3.5 text-[11px] font-black uppercase text-[color:color-mix(in_srgb,var(--accent)_82%,var(--text))] shadow-none'
            : 'min-h-12 w-full rounded-xl bg-[var(--accent)] px-4 text-[15px] font-extrabold text-[var(--accent-text)] shadow-[0_12px_26px_color-mix(in_srgb,var(--accent)_18%,transparent)]'"
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
            class="match-stage relative overflow-hidden rounded-xl border border-[var(--line)] p-7 max-md:min-h-0 max-md:rounded-[10px] max-md:p-4"
            :class="isRoomRecentlyUpdated(activeRoom.id) ? 'room-update-pulse' : ''"
          >
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

              <div class="mt-0.5 grid w-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-0 border-t border-[var(--line)] pt-4 max-md:pt-3" aria-label="Event stats">
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

            <p
              class="mt-1 text-center text-[15px] leading-[1.45] font-medium text-[var(--muted)] max-md:hidden"
            >
              Drop your score and let the room react.
            </p>
          </section>
        </div>

        <section
          class="hidden min-h-11 items-center justify-between gap-3 rounded-[10px] border bg-[color:color-mix(in_srgb,var(--panel)_68%,transparent)] px-3.5 py-2.5 text-left max-md:flex"
          :class="[
            activeRoom.predictions.length ? 'border-[color:color-mix(in_srgb,var(--accent)_20%,var(--line))] shadow-[0_10px_24px_color-mix(in_srgb,var(--text)_5%,transparent)]' : 'border-dashed border-[color:color-mix(in_srgb,var(--muted)_34%,var(--line))]',
            isRoomRecentlyUpdated(activeRoom.id) ? 'room-update-pulse' : '',
          ]"
          :aria-label="activeRoom.predictions.length ? `Top pick: ${activeRoom.home.code} ${activeRoom.mostBacked.home}, ${activeRoom.away.code} ${activeRoom.mostBacked.away}` : 'No top pick yet'"
        >
          <span class="inline-flex min-w-0 items-center gap-1.5 whitespace-nowrap">
            <span class="text-[10px] font-black uppercase leading-none tracking-[0.08em]" :class="activeRoom.predictions.length ? 'text-[color:color-mix(in_srgb,var(--accent)_82%,var(--text))]' : 'text-[var(--muted)]'">Top pick</span>
            <span class="text-[var(--muted)]">·</span>
            <span v-if="activeRoom.predictions.length" class="truncate text-[12px] font-[650] leading-tight text-[var(--muted)]">{{ activeRoom.mostBacked.margin }}</span>
            <span v-else class="truncate text-[12px] font-[650] leading-tight text-[color:color-mix(in_srgb,var(--muted)_72%,transparent)]">No top pick yet</span>
          </span>

          <span v-if="activeRoom.predictions.length" class="inline-flex shrink-0 items-baseline gap-1.5 whitespace-nowrap [font-variant-numeric:tabular-nums]">
            <span class="text-[12px] font-black uppercase leading-none text-[color:color-mix(in_srgb,var(--text)_80%,var(--muted))]">{{ activeRoom.home.code }}</span>
            <span class="text-[19px] font-black leading-none text-[var(--text)]">{{ activeRoom.mostBacked.home }}</span>
            <span class="text-[13px] font-black leading-none text-[var(--accent)]">-</span>
            <span class="text-[19px] font-black leading-none text-[var(--text)]">{{ activeRoom.mostBacked.away }}</span>
            <span class="text-[12px] font-black uppercase leading-none text-[color:color-mix(in_srgb,var(--text)_80%,var(--muted))]">{{ activeRoom.away.code }}</span>
          </span>
          <span v-else class="shrink-0 text-[10px] font-black uppercase tracking-[0.06em] text-[color:color-mix(in_srgb,var(--muted)_62%,transparent)]">
            {{ activeRoomPredictionsClosed ? 'closed' : 'waiting' }}
          </span>
        </section>

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
              class="grid min-h-[66px] min-w-[218px] snap-start grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-lg border p-2 text-left transition-[background-color,border-color,transform] duration-150 ease-[var(--ease)] active:translate-y-px"
              :class="[
                room.id === activeRoomId ? 'border-[color:color-mix(in_srgb,var(--accent)_34%,var(--line))] bg-[color:color-mix(in_srgb,var(--accent)_6%,var(--panel))]' : 'border-[var(--line)] bg-[color:color-mix(in_srgb,var(--chip-bg)_46%,transparent)]',
                effectiveRoomMatchStatus(room) === 'finished' ? 'opacity-80' : '',
                isRoomRecentlyUpdated(room.id) ? 'room-update-pulse' : '',
              ]"
              type="button"
              @click="setActiveRoom(room.id)"
            >
              <span class="grid min-w-0 content-center gap-1.5 self-center">
                <span class="grid min-w-0 grid-cols-[28px_3ch_auto_28px_3ch] items-center gap-1.5 text-[12px] font-[820] leading-none text-[var(--text)]">
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
                class="grid min-w-[48px] content-center justify-items-center gap-1 justify-self-end self-center rounded-md border border-[color:color-mix(in_srgb,var(--accent)_18%,var(--line))] bg-[color:color-mix(in_srgb,var(--chip-bg)_62%,transparent)] px-1.5 py-1 text-[color:color-mix(in_srgb,var(--accent)_72%,var(--text))]"
                :aria-label="roomStatusLabel(room)"
              >
                <span v-if="showsLiveRoomIcon(room)" class="grid justify-items-center gap-1">
                  <span class="text-[8px] font-black uppercase leading-none text-[var(--accent)]">{{ mobileRoomStatusText(room) }}</span>
                  <span class="live-pulse-dot h-2 w-2 rounded-full bg-current" aria-hidden="true"></span>
                </span>
                <span v-else-if="effectiveRoomMatchStatus(room) === 'finished' || room.roomStatus === 'closed'" class="grid justify-items-center gap-1 text-[var(--muted)]">
                  <span class="text-[8px] font-black uppercase leading-none">{{ mobileRoomStatusText(room) }}</span>
                  <svg class="ph-icon h-3.5 w-3.5" viewBox="0 0 256 256" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="18">
                    <rect x="48" y="108" width="160" height="104" rx="16"></rect>
                    <path d="M88 108V76a40 40 0 0 1 80 0v32"></path>
                  </svg>
                </span>
                <span v-else class="grid justify-items-center gap-1">
                  <span class="text-[8px] font-black uppercase leading-none">{{ mobileRoomStatusText(room) }}</span>
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
              class="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg border border-[color:color-mix(in_srgb,var(--line)_78%,transparent)] bg-[color:color-mix(in_srgb,var(--chip-bg)_84%,transparent)] px-3 text-[13px] font-[760] text-[var(--soft)] shadow-[0_1px_0_color-mix(in_srgb,var(--text)_5%,transparent)] transition-[background-color,border-color,color,opacity,transform] duration-150 ease-[var(--ease)] hover:border-[color:color-mix(in_srgb,var(--accent)_24%,var(--line))] hover:bg-[color:color-mix(in_srgb,var(--accent)_6%,var(--chip-bg))] hover:text-[var(--text)] active:translate-y-px disabled:cursor-not-allowed disabled:border-[var(--line)] disabled:bg-[color:color-mix(in_srgb,var(--chip-bg)_44%,transparent)] disabled:text-[var(--muted)] disabled:opacity-50 disabled:shadow-none disabled:hover:bg-[color:color-mix(in_srgb,var(--chip-bg)_44%,transparent)] disabled:active:translate-y-0 max-sm:ml-auto max-sm:h-7 max-sm:min-h-7 max-sm:w-[58px] max-sm:gap-1 max-sm:self-baseline max-sm:rounded-md max-sm:border-[var(--line)] max-sm:bg-[color:color-mix(in_srgb,var(--chip-bg)_72%,transparent)] max-sm:px-1.5 max-sm:py-0 max-sm:text-[9px] max-sm:font-[780] max-sm:leading-none max-sm:text-[var(--soft)] max-sm:shadow-[0_1px_0_color-mix(in_srgb,var(--text)_5%,transparent)] md:min-h-9"
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
              class="inline-flex min-h-11 items-center justify-center rounded-lg bg-[var(--accent)] px-4 text-sm font-extrabold text-[var(--accent-text)] transition-[background-color,opacity,transform] duration-100 ease-[cubic-bezier(0.4,0,0.2,1)] hover:bg-[color:color-mix(in_srgb,var(--accent)_86%,black)] active:translate-y-px disabled:cursor-default disabled:bg-[color:color-mix(in_srgb,var(--accent)_18%,var(--chip-bg))] disabled:text-[color:color-mix(in_srgb,var(--accent)_72%,var(--text))] disabled:opacity-80 disabled:active:translate-y-0"
              type="button"
              :disabled="scoreCtaDisabled"
              @click="openPredictionModal"
            >
              {{ scoreCtaLabel }}
            </button>
          </div>

          <Transition v-else name="room-feed" mode="out-in">
            <div ref="predictionFeedList">
            <TransitionGroup :key="activeRoom.id" name="prediction-list" tag="div" class="grid gap-2.5 max-md:gap-3">
              <article
                v-for="item in sortedPredictions"
                :key="item.id"
                data-prediction-card
                class="prediction relative grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3 overflow-visible rounded-xl border border-[var(--line)] bg-[color:color-mix(in_srgb,var(--panel)_88%,transparent)] p-4 shadow-[var(--card-shadow)] transition-[background-color,border-color,box-shadow] duration-300 ease-[var(--ease)] max-md:grid-cols-[40px_minmax(0,1fr)_38px] max-md:gap-2.5 max-md:rounded-[10px] max-md:p-3"
                :class="[
                  leadComment(item) && (isReplying(item.id, leadComment(item)!.id) || isCommentsExpanded(item.id)) ? 'border-[color:color-mix(in_srgb,var(--accent)_30%,var(--line))] bg-[color:color-mix(in_srgb,var(--accent)_4%,var(--panel))] shadow-[0_14px_36px_rgba(42,37,32,0.10)]' : '',
                  isPredictionRecentlyUpdated(item.id) ? 'room-update-pulse' : '',
                  isOptimisticPrediction(item.id) ? 'opacity-80' : '',
                ]"
              >
              <div class="pt-0.5 max-md:pt-0">
                <img class="prediction-avatar" :src="predictionAvatar(item.name)" :alt="`${item.name} avatar`" loading="lazy" decoding="async" />
              </div>

              <div class="grid min-w-0 gap-2 max-md:gap-1.5">
                <div class="flex min-w-0 max-w-full items-center gap-2 overflow-hidden whitespace-nowrap max-sm:gap-1.5">
                  <h3 class="m-0 min-w-0 max-w-[44%] truncate text-[15px] font-black leading-tight text-[var(--text)] max-sm:max-w-[46%] max-sm:text-[14px]">{{ item.name }}</h3>
                  <span class="inline-flex shrink-0 items-center gap-1 rounded-md border border-[color:color-mix(in_srgb,var(--accent)_16%,var(--line))] bg-[color:color-mix(in_srgb,var(--chip-bg)_60%,transparent)] px-1.5 py-1 text-[10px] font-black uppercase leading-none text-[var(--muted)] [font-variant-numeric:tabular-nums] max-sm:px-1 max-sm:text-[9px]">
                    <span>{{ activeRoom.home.code }}</span>
                    <strong class="text-[14px] font-[900] text-[var(--text)] max-sm:text-[13px]">{{ item.homeScore }}-{{ item.awayScore }}</strong>
                    <span>{{ activeRoom.away.code }}</span>
                  </span>
                  <span v-if="isOptimisticPrediction(item.id)" class="ml-2 text-[10px] font-black uppercase leading-none text-[var(--accent)]">sending</span>
                </div>

                <div v-if="leadComment(item)" class="grid gap-1">
                  <form
                    v-if="editingPredictionId === item.id"
                    class="grid gap-2"
                    @submit.prevent="submitPredictionEdit(item)"
                  >
                    <textarea
                      :data-edit-key="item.id"
                      v-model="editDrafts[item.id]"
                      class="min-h-16 w-full resize-none rounded-lg border border-[var(--control-border)] bg-[var(--control-bg)] px-2.5 py-2 text-sm text-[var(--text)] outline-none transition-[border-color,box-shadow] duration-150 ease-[var(--ease)] focus:border-[color:color-mix(in_srgb,var(--accent)_46%,var(--control-border))] focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_10%,transparent)] disabled:cursor-wait disabled:opacity-70"
                      maxlength="280"
                      aria-label="Edit prediction text"
                      :disabled="isEditSubmitting(item.id)"
                    ></textarea>
                    <div class="flex flex-wrap items-center gap-2">
                      <button
                        class="inline-flex min-h-8 items-center justify-center rounded-md bg-[var(--accent)] px-3 text-xs font-extrabold text-[var(--accent-text)] transition-[background-color,opacity,transform] duration-100 ease-[cubic-bezier(0.4,0,0.2,1)] hover:bg-[color:color-mix(in_srgb,var(--accent)_86%,black)] active:translate-y-px disabled:cursor-wait disabled:opacity-65 disabled:active:translate-y-0"
                        type="submit"
                        :disabled="!canSubmitEdit(item.id, MIN_PREDICTION_COMMENT_LENGTH)"
                      >
                        {{ isEditSubmitting(item.id) ? 'Editing' : 'Edit' }}
                      </button>
                      <button
                        class="inline-flex min-h-8 items-center justify-center rounded-md px-2.5 text-xs font-bold text-[var(--muted)] transition-[background-color,color,transform] duration-100 ease-[cubic-bezier(0.4,0,0.2,1)] hover:bg-[color:color-mix(in_srgb,var(--chip-bg)_70%,transparent)] hover:text-[var(--text)] active:translate-y-px"
                        type="button"
                        :disabled="isEditSubmitting(item.id)"
                        @click="cancelEdit(item.id)"
                      >
                        Cancel
                      </button>
                    </div>
                    <p v-if="editErrors[item.id]" class="m-0 text-xs font-semibold text-[color:color-mix(in_srgb,#d14343_78%,var(--text))]">{{ editErrors[item.id] }}</p>
                  </form>
                  <div v-else class="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
                    <p data-lead-comment class="m-0 max-w-[62ch] text-[17px] leading-[1.4] text-[var(--soft)] max-md:text-[15px]">
                      {{ leadComment(item)?.text }}
                      <span v-if="leadComment(item)?.editedAt" class="ml-1 text-[11px] font-bold uppercase text-[var(--muted)]">edited</span>
                    </p>
                    <button
                      v-if="canEditPrediction(item)"
                      class="inline-flex min-h-7 shrink-0 items-center rounded-md px-2 text-[10px] font-bold text-[var(--muted)] transition-[background-color,color,transform] duration-100 ease-[cubic-bezier(0.4,0,0.2,1)] hover:bg-[color:color-mix(in_srgb,var(--chip-bg)_70%,transparent)] hover:text-[var(--accent)] active:translate-y-px"
                      type="button"
                      @click="startEditingPrediction(item)"
                    >
                      Edit
                    </button>
                  </div>
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
                      <form
                        v-if="editingReplyId === reply.id"
                        class="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-1.5 max-sm:grid-cols-[minmax(0,1fr)_auto]"
                        @submit.prevent="submitReplyEdit(reply)"
                      >
                        <input
                          :data-edit-key="reply.id"
                          v-model="editDrafts[reply.id]"
                          class="min-h-8 w-full rounded-md border border-[var(--control-border)] bg-[var(--control-bg)] px-2 text-xs text-[var(--text)] outline-none focus:border-[color:color-mix(in_srgb,var(--accent)_46%,var(--control-border))] disabled:cursor-wait disabled:opacity-70"
                          maxlength="280"
                          aria-label="Edit reply"
                          :disabled="isEditSubmitting(reply.id)"
                        />
                        <button
                          class="inline-flex min-h-8 items-center justify-center rounded-md bg-[var(--accent)] px-2 text-[10px] font-extrabold text-[var(--accent-text)] transition-[background-color,opacity,transform] duration-100 ease-[cubic-bezier(0.4,0,0.2,1)] hover:bg-[color:color-mix(in_srgb,var(--accent)_86%,black)] active:translate-y-px disabled:cursor-wait disabled:opacity-65 disabled:active:translate-y-0"
                          type="submit"
                          :disabled="!canSubmitEdit(reply.id)"
                        >
                          {{ isEditSubmitting(reply.id) ? 'Editing' : 'Edit' }}
                        </button>
                        <button
                          class="inline-flex min-h-8 items-center justify-center rounded-md px-2 text-[10px] font-bold text-[var(--muted)] transition-[background-color,color,transform] duration-100 ease-[cubic-bezier(0.4,0,0.2,1)] hover:bg-[color:color-mix(in_srgb,var(--chip-bg)_70%,transparent)] hover:text-[var(--text)] active:translate-y-px max-sm:col-span-2 max-sm:w-fit"
                          type="button"
                          :disabled="isEditSubmitting(reply.id)"
                          @click="cancelEdit(reply.id)"
                        >
                          Cancel
                        </button>
                        <p v-if="editErrors[reply.id]" class="col-span-full m-0 text-[11px] font-semibold text-[color:color-mix(in_srgb,#d14343_78%,var(--text))]">{{ editErrors[reply.id] }}</p>
                      </form>
                      <span v-else>
                        <strong>{{ reply.name }}:</strong> {{ reply.text }}
                        <span v-if="isOptimisticReply(reply.id)" class="ml-1 text-[9px] font-black uppercase text-[var(--accent)]">sending</span>
                        <span v-if="reply.editedAt" class="ml-1 text-[9px] font-bold uppercase text-[var(--muted)]">edited</span>
                        <button
                          v-if="canEditReply(reply)"
                          class="ml-1 inline-flex rounded px-1 text-[9px] font-bold text-[var(--muted)] transition-[background-color,color,transform] duration-100 ease-[cubic-bezier(0.4,0,0.2,1)] hover:bg-[color:color-mix(in_srgb,var(--chip-bg)_70%,transparent)] hover:text-[var(--accent)] active:translate-y-px"
                          type="button"
                          @click="startEditingReply(reply)"
                        >
                          Edit
                        </button>
                      </span>
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
                  <p
                    v-if="leadComment(item) && typingLabel('reply', leadComment(item)!.id)"
                    class="m-0 min-h-3.5 pl-3 text-[10px] font-[650] leading-tight text-[color:color-mix(in_srgb,var(--accent)_58%,var(--muted))]"
                    aria-live="polite"
                  >
                    {{ typingLabel('reply', leadComment(item)!.id) }}
                  </p>
                </div>

                <Transition name="reply-composer" @after-enter="focusReplyComposer">
                  <form
                    v-if="leadComment(item) && isReplying(item.id, leadComment(item)!.id)"
                    data-reply-composer
                    class="mt-1 grid scroll-mt-24 grid-cols-[minmax(0,1fr)_auto] gap-2 max-md:mb-2 max-md:grid-cols-[minmax(0,1fr)_auto]"
                    @submit.prevent="submitReply(leadComment(item)!.id)"
                  >
                    <input
                      :data-reply-key="leadComment(item)!.id"
                      v-model="replyDrafts[leadComment(item)!.id]"
                      class="min-h-9 w-full rounded-lg border border-[var(--control-border)] bg-[var(--control-bg)] px-2.5 text-sm text-[var(--text)] outline-none disabled:cursor-wait disabled:opacity-70"
                      aria-label="Reply"
                      placeholder="Keep it light..."
                      :disabled="isReplySubmitting(leadComment(item)!.id)"
                      @input="markTyping('reply', leadComment(item)!.id)"
                      @blur="stopTyping('reply', leadComment(item)!.id)"
                    />
                    <button
                      class="hidden min-h-9 min-w-9 items-center justify-center rounded-lg border border-[var(--control-border)] bg-[color:color-mix(in_srgb,var(--control-bg)_76%,transparent)] text-[var(--muted)] transition-[background-color,border-color,color,transform] duration-100 ease-[cubic-bezier(0.4,0,0.2,1)] active:translate-y-px max-md:inline-flex"
                      type="button"
                      aria-label="Close reply input"
                      :disabled="isReplySubmitting(leadComment(item)!.id)"
                      @click="closeReplyComposer(leadComment(item)!.id)"
                    >
                      <svg class="ph-icon h-4 w-4" viewBox="0 0 256 256" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="20">
                        <path d="M72 72l112 112"></path>
                        <path d="M184 72 72 184"></path>
                      </svg>
                    </button>
                    <button
                      class="inline-flex min-h-9 items-center justify-center rounded-lg bg-[var(--accent)] px-3 text-xs font-extrabold text-[var(--accent-text)] transition-[background-color,opacity,transform] duration-100 ease-[cubic-bezier(0.4,0,0.2,1)] hover:bg-[color:color-mix(in_srgb,var(--accent)_86%,black)] active:translate-y-px disabled:cursor-wait disabled:opacity-65 disabled:active:translate-y-0 max-md:col-span-2"
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
                  :class="leadComment(item) && isReplying(item.id, leadComment(item)!.id) ? 'border-[color:color-mix(in_srgb,var(--accent)_24%,var(--line))] bg-[color:color-mix(in_srgb,var(--accent)_9%,var(--chip-bg))] text-[var(--accent)]' : ''"
                  type="button"
                  :aria-expanded="leadComment(item) ? String(isReplying(item.id, leadComment(item)!.id)) : 'false'"
                  :aria-label="`Reply to ${item.name}. ${predictionCommentTotal(item)} comments and replies`"
                  @click="leadComment(item) && toggleReply(item.id, leadComment(item)!.id)"
                >
                  <svg class="ph-icon h-5 w-5 max-md:h-4 max-md:w-4" viewBox="0 0 256 256" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="18">
                    <path d="M45.2 188.7A88 88 0 1 1 76 219.5L36 228Z"></path>
                  </svg>
                  <span :key="predictionCommentTotal(item)" class="reaction-count [font-variant-numeric:tabular-nums]">{{ predictionCommentTotal(item) }}</span>
                  <span
                    v-if="leadComment(item) && hasReplyDraft(leadComment(item)!.id)"
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
          class="fixed right-4 bottom-[calc(82px+env(safe-area-inset-bottom))] z-[720] hidden h-11 w-11 place-items-center rounded-full border border-[color:color-mix(in_srgb,var(--line)_72%,transparent)] bg-[color:color-mix(in_srgb,var(--panel)_88%,transparent)] text-[var(--text)] shadow-[0_14px_30px_color-mix(in_srgb,var(--text)_12%,transparent)] backdrop-blur-md transition-[background-color,border-color,color,transform,opacity] duration-150 ease-[var(--ease)] active:translate-y-px max-md:grid"
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

            <button class="inline-flex min-h-11 items-center justify-center rounded-lg bg-[var(--accent)] px-[14px] text-[13px] font-extrabold text-[var(--accent-text)] transition-[background-color,opacity,transform] duration-100 ease-[cubic-bezier(0.4,0,0.2,1)] hover:bg-[color:color-mix(in_srgb,var(--accent)_86%,black)] active:translate-y-px disabled:cursor-default disabled:bg-[color:color-mix(in_srgb,var(--accent)_18%,var(--chip-bg))] disabled:text-[color:color-mix(in_srgb,var(--accent)_72%,var(--text))] disabled:opacity-80 disabled:active:translate-y-0" type="button" :disabled="scoreCtaDisabled" @click="openPredictionModal">{{ scoreCtaLabel }}</button>
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
      :open="identityPromptOpen"
      :can-save="canSaveUsername"
      :error="usernameError"
      :message="identityPromptMessage"
      @close="closeIdentityPrompt"
      @save="saveUsername"
    />

    <ScoreDrawer
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
  </main>
</template>
