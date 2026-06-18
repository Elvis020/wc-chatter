import { DurableObject } from 'cloudflare:workers'
import type { ApiEvent } from '@wc-chatter/shared'

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
    }
  }
}
