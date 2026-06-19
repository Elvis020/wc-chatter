import type { ThemeId } from '@wc-chatter/shared'

const STORAGE_KEYS = {
  userId: 'wc-chatter-user-id',
  username: 'wc-chatter-username',
  likes: 'wc-chatter-liked-predictions',
  theme: 'wc-chatter-theme',
  activeRoomId: 'wc-chatter-active-room-id',
  predictionDrafts: 'wc-chatter-prediction-drafts',
  replyDrafts: 'wc-chatter-reply-drafts',
  prizeClaims: 'wc-chatter-prize-claims',
} as const
const VALID_THEMES = new Set<ThemeId>(['paper', 'desk', 'pub', 'press'])
const memoryStorage = new Map<string, string>()

function readStorage(key: string) {
  try {
    return localStorage.getItem(key) ?? memoryStorage.get(key) ?? ''
  } catch {
    return memoryStorage.get(key) ?? ''
  }
}

function writeStorage(key: string, value: string) {
  memoryStorage.set(key, value)
  try {
    localStorage.setItem(key, value)
  } catch {
    // Keep the in-memory value for browsers or contexts where storage is blocked.
  }
}

function createUserId() {
  if (globalThis.crypto?.randomUUID) {
    return `user-${globalThis.crypto.randomUUID()}`
  }

  return `user-${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`
}

export function getOrCreateUserId() {
  const existing = readStorage(STORAGE_KEYS.userId)
  if (existing) return existing

  const next = createUserId()
  writeStorage(STORAGE_KEYS.userId, next)
  return next
}

export function getStoredUsername() {
  return readStorage(STORAGE_KEYS.username)
}

export function setStoredUsername(value: string) {
  writeStorage(STORAGE_KEYS.username, value)
}

export function getStoredLikes() {
  try {
    return new Set<string>(JSON.parse(readStorage(STORAGE_KEYS.likes) || '[]'))
  } catch {
    return new Set<string>()
  }
}

export function setStoredLikes(likes: Set<string>) {
  writeStorage(STORAGE_KEYS.likes, JSON.stringify([...likes]))
}

export function getStoredPrizeClaims() {
  try {
    return new Set<string>(JSON.parse(readStorage(STORAGE_KEYS.prizeClaims) || '[]'))
  } catch {
    return new Set<string>()
  }
}

export function setStoredPrizeClaims(claims: Set<string>) {
  writeStorage(STORAGE_KEYS.prizeClaims, JSON.stringify([...claims]))
}

export function getStoredTheme(): ThemeId {
  const storedTheme = readStorage(STORAGE_KEYS.theme) as ThemeId
  return VALID_THEMES.has(storedTheme) ? storedTheme : 'paper'
}

export function setStoredTheme(value: ThemeId) {
  writeStorage(STORAGE_KEYS.theme, value)
}

export function getStoredActiveRoomId() {
  return readStorage(STORAGE_KEYS.activeRoomId)
}

export function setStoredActiveRoomId(value: string) {
  writeStorage(STORAGE_KEYS.activeRoomId, value)
}

function getStoredRecord(key: string) {
  try {
    const value = JSON.parse(readStorage(key) || '{}') as Record<string, string>
    return value && typeof value === 'object' ? value : {}
  } catch {
    return {}
  }
}

function setStoredRecord(key: string, value: Record<string, string>) {
  const compact = Object.fromEntries(
    Object.entries(value).filter(([, text]) => text.trim().length > 0),
  )
  writeStorage(key, JSON.stringify(compact))
}

export function getStoredPredictionDrafts() {
  return getStoredRecord(STORAGE_KEYS.predictionDrafts)
}

export function setStoredPredictionDrafts(value: Record<string, string>) {
  setStoredRecord(STORAGE_KEYS.predictionDrafts, value)
}

export function getStoredReplyDrafts() {
  return getStoredRecord(STORAGE_KEYS.replyDrafts)
}

export function setStoredReplyDrafts(value: Record<string, string>) {
  setStoredRecord(STORAGE_KEYS.replyDrafts, value)
}
