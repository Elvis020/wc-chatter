import type { BootstrapResponse, CreatePredictionInput, PredictionCommentInput, PrizeDeskEntry, ReplyInput, Room, ToggleLikeInput, UpdateReplyInput } from '@turntabl-score-room/shared'

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '')
}

export function resolveApiBaseUrl(explicitApiUrl?: string) {
  if (explicitApiUrl) {
    return trimTrailingSlash(explicitApiUrl)
  }

  if (typeof window !== 'undefined') {
    return trimTrailingSlash(window.location.origin)
  }

  return 'http://localhost:8787'
}

export function resolveWsBaseUrl(explicitWsUrl?: string, apiUrl = resolveApiBaseUrl(import.meta.env.VITE_API_URL)) {
  if (explicitWsUrl) {
    return trimTrailingSlash(explicitWsUrl)
  }

  const wsUrl = new URL(apiUrl)
  wsUrl.protocol = wsUrl.protocol === 'https:' ? 'wss:' : 'ws:'
  wsUrl.pathname = `${wsUrl.pathname.replace(/\/+$/, '')}/ws`
  wsUrl.search = ''
  wsUrl.hash = ''
  return trimTrailingSlash(wsUrl.toString())
}

const apiBaseUrl = resolveApiBaseUrl(import.meta.env.VITE_API_URL)
const wsBaseUrl = resolveWsBaseUrl(import.meta.env.VITE_WS_URL, apiBaseUrl)

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let message = `Request failed with ${response.status}`

    try {
      const body = (await response.json()) as { error?: { message?: string } }
      message = body.error?.message || message
    } catch {
      // Keep the status-based fallback when the response is not JSON.
    }

    throw new Error(message)
  }

  return (await response.json()) as T
}

export async function fetchBootstrap() {
  return parseResponse<BootstrapResponse>(await fetch(`${apiBaseUrl}/api/bootstrap`))
}

export async function fetchPrizeDeskEntries() {
  return parseResponse<{ entries: PrizeDeskEntry[] }>(await fetch(`${apiBaseUrl}/api/admin/prize-claims`))
}

export async function fetchRoom(roomId: string) {
  return parseResponse<{ room: Room }>(await fetch(`${apiBaseUrl}/api/rooms/${roomId}`))
}

export async function createPrediction(roomId: string, payload: CreatePredictionInput) {
  return parseResponse<{ room: Room }>(
    await fetch(`${apiBaseUrl}/api/rooms/${roomId}/predictions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  )
}

export async function togglePredictionLike(predictionId: string, payload: ToggleLikeInput) {
  return parseResponse<{ room: Room }>(
    await fetch(`${apiBaseUrl}/api/predictions/${predictionId}/likes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  )
}

export async function createReply(commentId: string, payload: ReplyInput) {
  return parseResponse<{ room: Room }>(
    await fetch(`${apiBaseUrl}/api/comments/${commentId}/replies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  )
}

export async function createPredictionComment(predictionId: string, payload: PredictionCommentInput) {
  return parseResponse<{ room: Room }>(
    await fetch(`${apiBaseUrl}/api/predictions/${predictionId}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  )
}

export async function updateReply(replyId: string, payload: UpdateReplyInput) {
  return parseResponse<{ room: Room }>(
    await fetch(`${apiBaseUrl}/api/replies/${replyId}/edit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  )
}

export function connectRoomEvents(roomId: string, onMessage: (event: MessageEvent<string>) => void) {
  const ws = new WebSocket(`${wsBaseUrl}/${roomId}`)
  ws.addEventListener('message', onMessage)
  return ws
}
