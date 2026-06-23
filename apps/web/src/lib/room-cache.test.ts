import { describe, expect, test } from 'bun:test'
import type { Prediction, Room } from '@turntabl-score-room/shared'
import {
  addRoomPrediction,
  removeRoomPrediction,
  removeRoomReply,
  updateRoomPrediction,
  updateRoomReply,
  updateRoomReplyThread,
} from './room-cache'

const basePrediction: Prediction = {
  id: 'prediction-1',
  authorId: 'user-1',
  name: 'Ama',
  homeScore: 1,
  awayScore: 0,
  likes: 2,
  createdAt: '2026-06-22T10:00:00.000Z',
  comments: [
    {
      id: 'comment-1',
      authorId: 'user-1',
      name: 'Ama',
      text: 'First',
      createdAt: '2026-06-22T10:01:00.000Z',
      replies: [
        {
          id: 'reply-1',
          authorId: 'user-2',
          name: 'Kojo',
          text: 'Reply',
          createdAt: '2026-06-22T10:02:00.000Z',
        },
      ],
    },
  ],
}

function room(predictions: Prediction[] = [basePrediction]): Room {
  return {
    id: 'room-1',
    status: 'upcoming',
    matchStatus: 'upcoming',
    roomStatus: 'open',
    isFeatured: false,
    home: { name: 'USA', code: 'USA', iso2: 'US', flag: '🇺🇸' },
    away: { name: 'Australia', code: 'AUS', iso2: 'AU', flag: '🇦🇺' },
    mostBacked: { home: 1, away: 0, margin: 'USA by 1' },
    predictions,
  }
}

describe('room cache transforms', () => {
  test('adds and removes optimistic predictions while recalculating most backed', () => {
    const nextPrediction: Prediction = {
      ...basePrediction,
      id: 'prediction-2',
      homeScore: 2,
      awayScore: 1,
      likes: 9,
      createdAt: '2026-06-22T10:03:00.000Z',
      comments: [],
    }

    const added = addRoomPrediction([room()], 'room-1', nextPrediction)
    expect(added[0].predictions.map((prediction) => prediction.id)).toEqual(['prediction-2', 'prediction-1'])
    expect(added[0].mostBacked).toEqual({ home: 2, away: 1, margin: 'USA by 1' })

    const removed = removeRoomPrediction(added, 'prediction-2')
    expect(removed[0].predictions.map((prediction) => prediction.id)).toEqual(['prediction-1'])
  })

  test('updates predictions and nested replies immutably', () => {
    const updatedPrediction = updateRoomPrediction([room()], 'prediction-1', (prediction) => ({
      ...prediction,
      likes: prediction.likes + 1,
    }))
    expect(updatedPrediction[0].predictions[0].likes).toBe(3)

    const withReply = updateRoomReplyThread(updatedPrediction, 'comment-1', (replies) => [
      ...replies,
      {
        id: 'reply-2',
        authorId: 'user-3',
        name: 'Nadia',
        text: 'Second reply',
        createdAt: '2026-06-22T10:04:00.000Z',
      },
    ])
    expect(withReply[0].predictions[0].comments[0].replies).toHaveLength(2)

    const editedReply = updateRoomReply(withReply, 'reply-2', (reply) => ({ ...reply, text: 'Edited' }))
    expect(editedReply[0].predictions[0].comments[0].replies[1].text).toBe('Edited')

    const removedReply = removeRoomReply(editedReply, 'reply-2')
    expect(removedReply[0].predictions[0].comments[0].replies.map((reply) => reply.id)).toEqual(['reply-1'])
  })
})
