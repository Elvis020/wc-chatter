import { describe, expect, test } from 'bun:test'
import { mapPredictions } from '../src/supabase-store'

describe('supabase store hydration', () => {
  test('hydrates predictions with likes, comments, and replies grouped by room', () => {
    const byRoom = mapPredictions(
      [
        {
          id: 'prediction-1',
          room_id: 'room-1',
          author_id: 'user-1',
          author_name: 'Elvi',
          home_score: 2,
          away_score: 1,
          take: 'We take this.',
          created_at: '2026-06-19T10:00:00.000Z',
          edited_at: '2026-06-19T10:01:00.000Z',
        },
      ],
      [
        { prediction_id: 'prediction-1', user_id: 'user-1' },
        { prediction_id: 'prediction-1', user_id: 'user-2' },
      ],
      [
        {
          id: 'comment-1',
          prediction_id: 'prediction-1',
          author_id: 'user-1',
          author_name: 'Elvi',
          text: 'We take this.',
          created_at: '2026-06-19T10:00:01.000Z',
          edited_at: '2026-06-19T10:01:01.000Z',
        },
      ],
      [
        {
          id: 'reply-1',
          comment_id: 'comment-1',
          author_id: 'user-2',
          author_name: 'Ama',
          text: 'Bold.',
          created_at: '2026-06-19T10:00:02.000Z',
          edited_at: '2026-06-19T10:01:02.000Z',
        },
      ],
    )

    expect(byRoom.get('room-1')).toEqual([
      {
        id: 'prediction-1',
        authorId: 'user-1',
        name: 'Elvi',
        homeScore: 2,
        awayScore: 1,
        likes: 2,
        createdAt: '2026-06-19T10:00:00.000Z',
        editedAt: '2026-06-19T10:01:00.000Z',
        comments: [
          {
            id: 'comment-1',
            authorId: 'user-1',
            text: 'We take this.',
            editedAt: '2026-06-19T10:01:01.000Z',
            replies: [
              {
                id: 'reply-1',
                authorId: 'user-2',
                name: 'Ama',
                text: 'Bold.',
                createdAt: '2026-06-19T10:00:02.000Z',
                editedAt: '2026-06-19T10:01:02.000Z',
              },
            ],
          },
        ],
      },
    ])
  })
})
