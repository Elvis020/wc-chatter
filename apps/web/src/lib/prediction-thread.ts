import type { Prediction } from '@turntabl-score-room/shared'

export type PredictionThreadEntry = {
  id: string
  type: 'comment' | 'reply'
  name: string
  text: string
  createdAt: string
  editedAt?: string
}

export function leadComment(prediction: Prediction) {
  return prediction.comments.find((comment) => comment.authorId === prediction.authorId) ?? null
}

export function secondaryComments(prediction: Prediction) {
  const ownerLead = leadComment(prediction)
  return prediction.comments.filter((comment) => comment.id !== ownerLead?.id)
}

export function threadEntries(prediction: Prediction): PredictionThreadEntry[] {
  const ownerLead = leadComment(prediction)
  const entries: PredictionThreadEntry[] = []

  for (const comment of secondaryComments(prediction)) {
    entries.push({
      id: comment.id,
      type: 'comment',
      name: comment.name,
      text: comment.text,
      createdAt: comment.createdAt,
      editedAt: comment.editedAt,
    })

    for (const reply of comment.replies) {
      entries.push({
        id: reply.id,
        type: 'reply',
        name: reply.name,
        text: reply.text,
        createdAt: reply.createdAt,
        editedAt: reply.editedAt,
      })
    }
  }

  for (const reply of ownerLead?.replies ?? []) {
    entries.push({
      id: reply.id,
      type: 'reply',
      name: reply.name,
      text: reply.text,
      createdAt: reply.createdAt,
      editedAt: reply.editedAt,
    })
  }

  return entries.sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
}

export function replyComposerLabel(prediction: Prediction) {
  return leadComment(prediction) ? 'Reply' : 'Add a comment'
}

export function replyComposerPlaceholder(prediction: Prediction) {
  if (leadComment(prediction)) return 'Keep it light...'
  return threadEntries(prediction).length ? 'Join the thread...' : 'Start the thread...'
}

export function replyActionLabel(prediction: Prediction) {
  const commentTotal = prediction.comments.reduce((sum, comment) => sum + 1 + comment.replies.length, 0)

  if (leadComment(prediction)) {
    return `Reply to ${prediction.name}. ${commentTotal} comments and replies`
  }

  if (threadEntries(prediction).length) {
    return `Comment under ${prediction.name}'s prediction. ${commentTotal} comments in thread.`
  }

  return `Comment on ${prediction.name}'s prediction. Start the thread.`
}

export function replySubmitLabel(prediction: Prediction) {
  return leadComment(prediction) ? 'Reply' : 'Comment'
}
