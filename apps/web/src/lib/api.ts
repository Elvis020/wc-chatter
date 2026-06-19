import type { BootstrapResponse, CreatePredictionInput, ReplyInput, Room, ToggleLikeInput, UpdatePredictionInput, UpdateReplyInput } from '@wc-chatter/shared'

const apiBaseUrl = import.meta.env.VITE_API_URL || 'http://localhost:8787'
const wsBaseUrl = import.meta.env.VITE_WS_URL || 'ws://localhost:8787/ws'

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

export async function updatePredictionText(predictionId: string, payload: UpdatePredictionInput) {
  return parseResponse<{ room: Room }>(
    await fetch(`${apiBaseUrl}/api/predictions/${predictionId}/edit`, {
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
