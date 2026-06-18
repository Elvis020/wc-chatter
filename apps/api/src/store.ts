import {
  mockThemes,
  type ApiEvent,
  type CreatePredictionInput,
  type Prediction,
  type Reply,
  type ReplyInput,
  type Room,
  type ThemeOption,
} from '@wc-chatter/shared'
import { createMockRooms } from '@wc-chatter/shared/mock-data'
import { ApiError } from './errors.js'

type WebSocketLike = {
  send: (data: string) => void
  readyState?: number
}

function cloneRoom(room: Room): Room {
  return structuredClone(room)
}

function formatMargin(homeName: string, awayName: string, homeScore: number, awayScore: number) {
  if (homeScore === awayScore) {
    return 'Draw backed most'
  }

  const side = homeScore > awayScore ? homeName : awayName
  const gap = Math.abs(homeScore - awayScore)
  return `${side} by ${gap}`
}

export function createStore() {
  const rooms = createMockRooms()
  const clients = new Map<string, WebSocketLike>()
  const likesByPrediction = new Map<string, Set<string>>()

  return {
    getRooms(): Room[] {
      return rooms.map(cloneRoom)
    },
    getThemes(): ThemeOption[] {
      return mockThemes
    },
    registerClient(clientId: string, ws: WebSocketLike) {
      clients.set(clientId, ws)
    },
    unregisterClient(clientId: string) {
      clients.delete(clientId)
    },
    broadcast(event: ApiEvent) {
      const payload = JSON.stringify(event)
      for (const [clientId, ws] of clients.entries()) {
        try {
          ws.send(payload)
        } catch {
          clients.delete(clientId)
        }
      }
    },
    addPrediction(roomId: string, payload: CreatePredictionInput) {
      const room = rooms.find((item) => item.id === roomId)
      if (!room) return null
      if (room.matchStatus === 'finished' || room.roomStatus !== 'open') {
        throw new ApiError('FORBIDDEN', 'This room is closed for new predictions.', 403)
      }

      const prediction: Prediction = {
        id: `prediction-${roomId}-${Date.now()}`,
        authorId: payload.authorId,
        name: payload.name,
        homeScore: payload.homeScore,
        awayScore: payload.awayScore,
        likes: 0,
        createdAt: new Date().toISOString(),
        comments: [
          {
            id: `comment-${roomId}-${Date.now()}`,
            authorId: payload.authorId,
            text: payload.comment?.trim() || 'Fresh from the confidence department.',
            replies: [],
          },
        ],
      }

      room.predictions.unshift(prediction)
      room.mostBacked = {
        home: payload.homeScore,
        away: payload.awayScore,
        margin: formatMargin(room.home.name, room.away.name, payload.homeScore, payload.awayScore),
      }
      return cloneRoom(room)
    },
    setPredictionLike(predictionId: string, userId: string, liked: boolean) {
      const room = rooms.find((item) => item.predictions.some((prediction) => prediction.id === predictionId))
      if (!room) return null

      const prediction = room.predictions.find((item) => item.id === predictionId)
      if (!prediction) return null

      const likedBy = likesByPrediction.get(predictionId) ?? new Set<string>()
      likesByPrediction.set(predictionId, likedBy)

      if (liked && !likedBy.has(userId)) {
        likedBy.add(userId)
        prediction.likes += 1
      } else if (!liked && likedBy.has(userId)) {
        likedBy.delete(userId)
        prediction.likes = Math.max(0, prediction.likes - 1)
      }

      return cloneRoom(room)
    },
    addReply(commentId: string, payload: ReplyInput) {
      const room = rooms.find((item) =>
        item.predictions.some((prediction) => prediction.comments.some((comment) => comment.id === commentId)),
      )
      if (!room) return null

      for (const prediction of room.predictions) {
        const comment = prediction.comments.find((item) => item.id === commentId)
        if (!comment) continue

        const reply: Reply = {
          id: `reply-${commentId}-${Date.now()}`,
          authorId: payload.authorId,
          name: payload.name,
          text: payload.text.trim(),
          createdAt: new Date().toISOString(),
        }

        comment.replies.push(reply)
        return cloneRoom(room)
      }

      return null
    },
  }
}
