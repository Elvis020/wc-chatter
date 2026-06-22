import { describe, expect, test } from 'bun:test'
import { createStore } from '../src/store'

describe('fallback store prize pickup verification', () => {
  test('saves pickup question and answer when creating a prediction', () => {
    const store = createStore()
    const [room] = store.getRooms()

    if (!room) throw new Error('Expected at least one mock room.')

    store.addPrediction(room.id, {
      authorId: 'user-00000000-0000-4000-8000-000000000001',
      name: 'Kojo',
      homeScore: 2,
      awayScore: 1,
      prizeQuestion: 'What should admin ask?',
      prizeAnswer: 'Blue',
    })

    expect(store.getPrizeDeskEntries()[0]).toMatchObject({
      roomId: room.id,
      authorId: 'user-00000000-0000-4000-8000-000000000001',
      authorName: 'Kojo',
      predictedHomeScore: 2,
      predictedAwayScore: 1,
      pickup: {
        question: 'What should admin ask?',
        answer: 'Blue',
      },
    })
  })

  test('allows the first comment to be added after a score-only prediction is posted', () => {
    const store = createStore()
    const [room] = store.getRooms()

    if (!room) throw new Error('Expected at least one mock room.')

    const updatedRoom = store.addPrediction(room.id, {
      authorId: 'user-00000000-0000-4000-8000-000000000001',
      name: 'Kojo',
      homeScore: 3,
      awayScore: 1,
    })

    const prediction = updatedRoom.predictions[0]
    if (!prediction) throw new Error('Expected prediction to be created.')

    expect(prediction.comments).toEqual([])

    const roomWithComment = store.addPredictionComment(prediction.id, {
      authorId: 'user-00000000-0000-4000-8000-000000000002',
      name: 'Ama',
      text: 'This one is brave.',
    })

    expect(roomWithComment?.predictions[0]?.comments).toMatchObject([
      {
        authorId: 'user-00000000-0000-4000-8000-000000000002',
        text: 'This one is brave.',
        replies: [],
      },
    ])
  })
})
