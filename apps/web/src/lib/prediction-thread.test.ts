import { describe, expect, test } from 'bun:test'
import type { Prediction } from '@turntabl-score-room/shared'
import {
  leadComment,
  replyActionLabel,
  replyComposerLabel,
  replyComposerPlaceholder,
  replySubmitLabel,
  threadEntries,
} from './prediction-thread'

const prediction: Prediction = {
  id: 'prediction-1',
  authorId: 'user-1',
  name: 'Ama',
  homeScore: 2,
  awayScore: 1,
  likes: 0,
  createdAt: '2026-06-22T10:00:00.000Z',
  comments: [
    {
      id: 'lead',
      authorId: 'user-1',
      name: 'Ama',
      text: 'This is my pick.',
      createdAt: '2026-06-22T10:01:00.000Z',
      replies: [
        {
          id: 'lead-reply',
          authorId: 'user-2',
          name: 'Kojo',
          text: 'Bold.',
          createdAt: '2026-06-22T10:03:00.000Z',
        },
      ],
    },
    {
      id: 'secondary',
      authorId: 'user-3',
      name: 'Nadia',
      text: 'I disagree.',
      createdAt: '2026-06-22T10:02:00.000Z',
      replies: [
        {
          id: 'secondary-reply',
          authorId: 'user-4',
          name: 'Elvi',
          text: 'Same.',
          createdAt: '2026-06-22T10:04:00.000Z',
        },
      ],
    },
  ],
}

describe('prediction thread view model', () => {
  test('keeps the author comment as lead and flattens the rest newest-first', () => {
    expect(leadComment(prediction)?.id).toBe('lead')
    expect(threadEntries(prediction).map((entry) => [entry.id, entry.type])).toEqual([
      ['secondary-reply', 'reply'],
      ['lead-reply', 'reply'],
      ['secondary', 'comment'],
    ])
  })

  test('labels reply composer from the presence of a lead comment', () => {
    expect(replyComposerLabel(prediction)).toBe('Reply')
    expect(replyComposerPlaceholder(prediction)).toBe('Keep it light...')
    expect(replyActionLabel(prediction)).toBe('Reply to Ama. 4 comments and replies')
    expect(replySubmitLabel(prediction)).toBe('Reply')
  })
})
