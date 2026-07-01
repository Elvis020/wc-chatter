import { describe, expect, test } from 'bun:test'
import { mapPredictions, mapRoom } from '../src/supabase-store'

describe('supabase store hydration', () => {
  test('overlays resolved fixture teams when persisted knockout room rows are stale', () => {
    const room = mapRoom(
      {
        id: 'room-1',
        slug: '2026-07-01-80-1l-3e-h-i-j-k',
        title: '1L vs 3E/H/I/J/K',
        home_name: '1L',
        home_code: '1L',
        home_iso2: '',
        home_flag: '',
        away_name: '3E/H/I/J/K',
        away_code: '3HI',
        away_iso2: '',
        away_flag: '',
        status: 'live',
        match_status: 'live',
        room_status: 'open',
        is_featured: true,
        event_date: '2026-07-01',
        kickoff_at: '2026-07-01T16:00:00.000Z',
        created_at: '2026-06-01T00:00:00.000Z',
      },
      new Map(),
    )

    expect(room.home).toMatchObject({
      name: 'England',
      code: 'ENG',
      iso2: 'gb-eng',
    })
    expect(room.away).toMatchObject({
      name: 'DR Congo',
      code: 'COD',
      iso2: 'CD',
    })
    expect(room.mostBacked.margin).toBe('No picks yet')
  })

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
            name: 'Elvi',
            text: 'We take this.',
            createdAt: '2026-06-19T10:00:01.000Z',
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

  test('hydrates predictions without comments as empty threads', () => {
    const byRoom = mapPredictions(
      [
        {
          id: 'prediction-blank',
          room_id: 'room-1',
          author_id: 'user-1',
          author_name: 'Elvi',
          home_score: 1,
          away_score: 0,
          take: null,
          created_at: '2026-06-19T10:00:00.000Z',
          edited_at: null,
        },
      ],
      [],
      [],
      [],
    )

    expect(byRoom.get('room-1')).toEqual([
      {
        id: 'prediction-blank',
        authorId: 'user-1',
        name: 'Elvi',
        homeScore: 1,
        awayScore: 0,
        likes: 0,
        createdAt: '2026-06-19T10:00:00.000Z',
        comments: [],
      },
    ])
  })
})
