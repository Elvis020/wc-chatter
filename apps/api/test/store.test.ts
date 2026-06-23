import { describe, expect, test } from 'bun:test'
import { createStore } from '../src/store'

describe('fallback store prize pickup verification', () => {
  test('saves pickup question and answer when creating a prediction', () => {
    const store = createStore()
    const room = store.getRooms().find((item) => item.matchStatus !== 'finished' && item.roomStatus === 'open')

    if (!room) throw new Error('Expected at least one writable mock room.')

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

  test('marks a winner prize as collected separately from pickup verification', () => {
    const store = createStore()
    const room = store.getRooms().find((item) => item.matchStatus !== 'finished' && item.roomStatus === 'open')

    if (!room) throw new Error('Expected at least one writable mock room.')

    const updatedRoom = store.addPrediction(room.id, {
      authorId: 'user-00000000-0000-4000-8000-000000000003',
      name: 'Esi',
      homeScore: 1,
      awayScore: 0,
      prizeQuestion: 'What should admin ask?',
      prizeAnswer: 'Green',
    })

    const prediction = updatedRoom?.predictions[0]
    if (!prediction) throw new Error('Expected prediction to be created.')

    const collectedEntry = store.setPrizePickupStatus(prediction.id, { pickedUp: true })

    expect(collectedEntry?.pickup?.pickedUpAt).toBeTruthy()

    const uncollectedEntry = store.setPrizePickupStatus(prediction.id, { pickedUp: false })

    expect(uncollectedEntry?.pickup?.pickedUpAt).toBeUndefined()
  })

  test('allows the first comment to be added after a score-only prediction is posted', () => {
    const store = createStore()
    const room = store.getRooms().find((item) => item.matchStatus !== 'finished' && item.roomStatus === 'open')

    if (!room) throw new Error('Expected at least one writable mock room.')

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
