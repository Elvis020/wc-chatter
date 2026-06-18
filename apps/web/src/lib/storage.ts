const STORAGE_KEYS = {
  userId: 'wc-chatter-user-id',
  username: 'wc-chatter-username',
  likes: 'wc-chatter-liked-predictions',
  theme: 'wc-chatter-theme',
} as const

export function getOrCreateUserId() {
  const existing = localStorage.getItem(STORAGE_KEYS.userId)
  if (existing) return existing

  const next = `user-${crypto.randomUUID()}`
  localStorage.setItem(STORAGE_KEYS.userId, next)
  return next
}

export function getStoredUsername() {
  return localStorage.getItem(STORAGE_KEYS.username) || ''
}

export function setStoredUsername(value: string) {
  localStorage.setItem(STORAGE_KEYS.username, value)
}

export function getStoredLikes() {
  try {
    return new Set<string>(JSON.parse(localStorage.getItem(STORAGE_KEYS.likes) || '[]'))
  } catch {
    return new Set<string>()
  }
}

export function setStoredLikes(likes: Set<string>) {
  localStorage.setItem(STORAGE_KEYS.likes, JSON.stringify([...likes]))
}

export function getStoredTheme() {
  return localStorage.getItem(STORAGE_KEYS.theme) || 'paper'
}

export function setStoredTheme(value: string) {
  localStorage.setItem(STORAGE_KEYS.theme, value)
}
