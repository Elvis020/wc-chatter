import { DurableObject } from 'cloudflare:workers'
import type { ApiEvent, TypingEvent } from '@turntabl-score-room/shared'

function typingEventFromMessage(message: string): TypingEvent | null {
  let payload: unknown

  try {
    payload = JSON.parse(message)
  } catch {
    return null
  }

  if (!payload || typeof payload !== 'object') return null

  const event = payload as Record<string, unknown>
  if (
    event.type !== 'typing'
    || typeof event.roomId !== 'string'
    || typeof event.userId !== 'string'
    || typeof event.name !== 'string'
    || event.target !== 'reply'
    || typeof event.targetId !== 'string'
    || typeof event.active !== 'boolean'
  ) {
    return null
  }

  return {
    type: 'typing',
    roomId: event.roomId.slice(0, 80),
    userId: event.userId.slice(0, 120),
    name: event.name.trim().slice(0, 24) || 'Someone',
    target: 'reply',
    targetId: event.targetId.slice(0, 120),
    active: event.active,
    at: new Date().toISOString(),
  }
}

export class RoomHub extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 })
    }

    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair)
    this.ctx.acceptWebSocket(server)

    return new Response(null, {
      status: 101,
      webSocket: client,
    })
  }

  broadcast(event: ApiEvent) {
    const payload = JSON.stringify(event)
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(payload)
      } catch {
        socket.close(1011, 'Unable to send update')
      }
    }
  }

  webSocketMessage(socket: WebSocket, message: string | ArrayBuffer) {
    if (message === 'ping') {
      socket.send('pong')
      return
    }

    if (typeof message !== 'string') return

    const event = typingEventFromMessage(message)
    if (event) {
      this.broadcast(event)
    }
  }
}
