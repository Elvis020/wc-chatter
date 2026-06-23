import {
  buildMostBackedSummary,
  mockThemes,
  prizeResultForScore,
  type ApiEvent,
  type PredictionCommentInput,
  type CreatePredictionInput,
  type Prediction,
  type PrizeDeskEntry,
  type PrizeClaim,
  type Reply,
  type ReplyInput,
  type Room,
  type ThemeOption,
  type UpdatePredictionInput,
  type UpdateReplyInput,
} from '@turntabl-score-room/shared'
import { createMockRooms } from '@turntabl-score-room/shared/mock-data'
import { ApiError } from './errors.js'

type WebSocketLike = {
  send: (data: string) => void
  readyState?: number
}

function cloneRoom(room: Room): Room {
  return structuredClone(room)
}

function assertRoomWritable(room: Room) {
  if (room.matchStatus === 'finished' || room.roomStatus !== 'open') {
    throw new ApiError('FORBIDDEN', 'This room is closed for edits.', 403)
  }
}

function prizeResultFor(room: Room, prediction: Prediction): PrizeDeskEntry['result'] {
  return prizeResultForScore(prediction, room.currentScore)
}

function mapPrizeDeskEntry(room: Room, prediction: Prediction, claim?: PrizeClaim): PrizeDeskEntry {
  return {
    id: prediction.id,
    roomId: room.id,
    roomTitle: `${room.home.name} vs ${room.away.name}`,
    matchStatus: room.matchStatus,
    home: room.home,
    away: room.away,
    finalScore: room.currentScore,
    predictionId: prediction.id,
    authorId: prediction.authorId,
    authorName: prediction.name,
    predictedHomeScore: prediction.homeScore,
    predictedAwayScore: prediction.awayScore,
    createdAt: prediction.createdAt,
    result: prizeResultFor(room, prediction),
    pickup: claim
      ? {
          claimId: claim.id,
          question: claim.question,
          answer: claim.answer,
          createdAt: claim.createdAt,
        }
      : undefined,
  }
}

export function createStore() {
  const rooms = createMockRooms()
  const clients = new Map<string, WebSocketLike>()
  const likesByPrediction = new Map<string, Set<string>>()
  const prizeClaims = new Map<string, PrizeClaim>()

  return {
    getRooms(): Room[] {
      return rooms.map(cloneRoom)
    },
    getRoom(roomId: string): Room | null {
      const room = rooms.find((item) => item.id === roomId)
      return room ? cloneRoom(room) : null
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
      assertRoomWritable(room)

      const comment = payload.comment?.trim()
      const prediction: Prediction = {
        id: `prediction-${roomId}-${Date.now()}`,
        authorId: payload.authorId,
        name: payload.name,
        homeScore: payload.homeScore,
        awayScore: payload.awayScore,
        likes: 0,
        createdAt: new Date().toISOString(),
        comments: comment
          ? [
              {
                id: `comment-${roomId}-${Date.now()}`,
                authorId: payload.authorId,
                name: payload.name,
                text: comment,
                replies: [],
                createdAt: new Date().toISOString(),
              },
            ]
          : [],
      }

      room.predictions.unshift(prediction)
      if (payload.prizeQuestion && payload.prizeAnswer) {
        prizeClaims.set(prediction.id, {
          id: `claim-${prediction.id}-${Date.now()}`,
          roomId: room.id,
          predictionId: prediction.id,
          authorId: payload.authorId,
          authorName: payload.name,
          question: payload.prizeQuestion,
          answer: payload.prizeAnswer,
          createdAt: prediction.createdAt,
        })
      }
      room.mostBacked = buildMostBackedSummary(
        { homeName: room.home.name, awayName: room.away.name },
        room.predictions,
      )
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
    updatePredictionText(predictionId: string, payload: UpdatePredictionInput) {
      const room = rooms.find((item) => item.predictions.some((prediction) => prediction.id === predictionId))
      if (!room) return null
      assertRoomWritable(room)

      const prediction = room.predictions.find((item) => item.id === predictionId)
      if (!prediction) return null
      if (prediction.authorId !== payload.userId) {
        throw new ApiError('FORBIDDEN', 'You can only edit your own prediction.', 403)
      }
      const editedAt = new Date().toISOString()
      prediction.editedAt = editedAt
      const [leadComment] = prediction.comments
      if (leadComment) {
        leadComment.text = payload.comment.trim()
        leadComment.editedAt = editedAt
      }

      return cloneRoom(room)
    },
    getPrizeDeskEntries() {
      return rooms
        .flatMap((room) =>
          room.predictions.map((prediction) => mapPrizeDeskEntry(room, prediction, prizeClaims.get(prediction.id))),
        )
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    },
    addPredictionComment(predictionId: string, payload: PredictionCommentInput) {
      const room = rooms.find((item) => item.predictions.some((prediction) => prediction.id === predictionId))
      if (!room) return null
      assertRoomWritable(room)

      const prediction = room.predictions.find((item) => item.id === predictionId)
      if (!prediction) return null

      const text = payload.text.trim()
      if (!text) {
        throw new ApiError('VALIDATION_ERROR', 'Comment is required.', 400)
      }

      prediction.comments.unshift({
        id: `comment-${predictionId}-${Date.now()}`,
        authorId: payload.authorId,
        name: payload.name,
        text,
        replies: [],
        createdAt: new Date().toISOString(),
      })

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
    updateReply(replyId: string, payload: UpdateReplyInput) {
      const room = rooms.find((item) =>
        item.predictions.some((prediction) =>
          prediction.comments.some((comment) => comment.replies.some((reply) => reply.id === replyId)),
        ),
      )
      if (!room) return null
      assertRoomWritable(room)

      for (const prediction of room.predictions) {
        for (const comment of prediction.comments) {
          const reply = comment.replies.find((item) => item.id === replyId)
          if (!reply) continue
          if (reply.authorId !== payload.userId) {
            throw new ApiError('FORBIDDEN', 'You can only edit your own reply.', 403)
          }
          reply.text = payload.text.trim()
          reply.editedAt = new Date().toISOString()
          return cloneRoom(room)
        }
      }

      return null
    },
  }
}
