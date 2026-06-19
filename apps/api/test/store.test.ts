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

    expect(store.getPrizeClaims()[0]).toMatchObject({
      roomId: room.id,
      authorId: 'user-00000000-0000-4000-8000-000000000001',
      authorName: 'Kojo',
      question: 'What should admin ask?',
      answer: 'Blue',
    })
  })
})
