import { existsSync, readFileSync } from 'node:fs'
import { createSupabaseClient, supabaseConfigFromEnv } from '../supabase-store.js'

const BATCH_SIZE = 100
const LOAD_AUTHOR_PATTERN = 'Load %'

function readEnvFile(url: URL) {
  if (!existsSync(url)) return {}

  return Object.fromEntries(
    readFileSync(url, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => {
        const index = line.indexOf('=')
        return [line.slice(0, index), line.slice(index + 1).replace(/^(['"])(.*)\1$/, '$2')]
      }),
  )
}

function chunks<T>(items: T[], size: number) {
  const result: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size))
  }
  return result
}

async function countRows(table: string, column: string, pattern: string) {
  const { count, error } = await supabase
    .from(table)
    .select('id', { count: 'exact', head: true })
    .like(column, pattern)

  if (error) throw new Error(`Unable to count ${table}: ${error.message}`)
  return count ?? 0
}

async function loadAuthorIds() {
  const authorIds = new Set<string>()
  const tables = ['predictions', 'comments', 'comment_replies']

  for (const table of tables) {
    const { data, error } = await supabase
      .from(table)
      .select('author_id')
      .like('author_name', LOAD_AUTHOR_PATTERN)

    if (error) throw new Error(`Unable to load ${table} author ids: ${error.message}`)

    for (const row of data ?? []) {
      if (row.author_id) authorIds.add(row.author_id)
    }
  }

  return [...authorIds]
}

async function deleteByAuthorName(table: string) {
  const { data, error } = await supabase
    .from(table)
    .delete()
    .like('author_name', LOAD_AUTHOR_PATTERN)
    .select('id')

  if (error) throw new Error(`Unable to delete ${table}: ${error.message}`)
  return data?.length ?? 0
}

async function deleteLikesByUserIds(userIds: string[]) {
  let deleted = 0

  for (const batch of chunks(userIds, BATCH_SIZE)) {
    const { data, error } = await supabase
      .from('prediction_likes')
      .delete()
      .in('user_id', batch)
      .select('prediction_id')

    if (error) throw new Error(`Unable to delete prediction likes: ${error.message}`)
    deleted += data?.length ?? 0
  }

  return deleted
}

const dryRun = process.argv.includes('--dry-run')
const env = {
  ...readEnvFile(new URL('../../../../.env.local', import.meta.url)),
  ...readEnvFile(new URL('../../.dev.vars', import.meta.url)),
  ...process.env,
}
const supabase = createSupabaseClient(supabaseConfigFromEnv(env))

const [predictionCount, commentCount, replyCount, authorIds] = await Promise.all([
  countRows('predictions', 'author_name', LOAD_AUTHOR_PATTERN),
  countRows('comments', 'author_name', LOAD_AUTHOR_PATTERN),
  countRows('comment_replies', 'author_name', LOAD_AUTHOR_PATTERN),
  loadAuthorIds(),
])

if (dryRun) {
  console.log(JSON.stringify({
    dryRun: true,
    wouldDelete: {
      predictions: predictionCount,
      comments: commentCount,
      replies: replyCount,
      likeAuthors: authorIds.length,
    },
  }, null, 2))
  process.exit(0)
}

const deletedLikes = await deleteLikesByUserIds(authorIds)
const deletedReplies = await deleteByAuthorName('comment_replies')
const deletedComments = await deleteByAuthorName('comments')
const deletedPredictions = await deleteByAuthorName('predictions')

console.log(JSON.stringify({
  dryRun: false,
  deleted: {
    predictionLikes: deletedLikes,
    replies: deletedReplies,
    comments: deletedComments,
    predictions: deletedPredictions,
  },
}, null, 2))
