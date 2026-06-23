import type { Prediction, Reply, Room } from '@turntabl-score-room/shared'

function formatScoreMargin(homeName: string, awayName: string, homeScore: number, awayScore: number) {
  if (homeScore === awayScore) return 'Draw backed most'
  const side = homeScore > awayScore ? homeName : awayName
  return `${side} by ${Math.abs(homeScore - awayScore)}`
}

function buildMostBackedSummary(room: Room, predictions: Prediction[]) {
  if (predictions.length === 0) return { home: 0, away: 0, margin: 'No picks yet' }

  const backed = new Map<string, { home: number; away: number; count: number; likes: number; createdAt: string }>()
  for (const prediction of predictions) {
    const key = `${prediction.homeScore}-${prediction.awayScore}`
    const existing = backed.get(key)
    if (existing) {
      existing.count += 1
      existing.likes += prediction.likes
      if (prediction.createdAt > existing.createdAt) existing.createdAt = prediction.createdAt
      continue
    }

    backed.set(key, {
      home: prediction.homeScore,
      away: prediction.awayScore,
      count: 1,
      likes: prediction.likes,
      createdAt: prediction.createdAt,
    })
  }

  const top = [...backed.values()].sort(
    (left, right) => right.count - left.count || right.likes - left.likes || right.createdAt.localeCompare(left.createdAt),
  )[0]

  return {
    home: top.home,
    away: top.away,
    margin: formatScoreMargin(room.home.name, room.away.name, top.home, top.away),
  }
}

export function updateRoomPrediction(
  rooms: Room[],
  predictionId: string,
  update: (prediction: Prediction) => Prediction,
) {
  let changed = false

  const nextRooms = rooms.map((room) => {
    let roomChanged = false
    const predictions = room.predictions.map((prediction) => {
      if (prediction.id !== predictionId) return prediction
      changed = true
      roomChanged = true
      return update(prediction)
    })

    return roomChanged ? { ...room, predictions } : room
  })

  return changed ? nextRooms : rooms
}

export function addRoomPrediction(rooms: Room[], roomId: string, prediction: Prediction) {
  return rooms.map((room) => {
    if (room.id !== roomId) return room
    const predictions = [prediction, ...room.predictions]

    return {
      ...room,
      mostBacked: buildMostBackedSummary(room, predictions),
      predictions,
    }
  })
}

export function removeRoomPrediction(rooms: Room[], predictionId: string) {
  return rooms.map((room) => {
    const predictions = room.predictions.filter((prediction) => prediction.id !== predictionId)
    return predictions.length === room.predictions.length ? room : { ...room, predictions }
  })
}

export function updateRoomReplyThread(
  rooms: Room[],
  commentId: string,
  update: (replies: Reply[]) => Reply[],
) {
  let changed = false

  const nextRooms = rooms.map((room) => {
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

  return changed ? nextRooms : rooms
}

export function updateRoomReply(rooms: Room[], replyId: string, update: (reply: Reply) => Reply) {
  let changed = false

  const nextRooms = rooms.map((room) => {
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

  return changed ? nextRooms : rooms
}

export function removeRoomReply(rooms: Room[], replyId: string) {
  let changed = false

  const nextRooms = rooms.map((room) => {
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

  return changed ? nextRooms : rooms
}
