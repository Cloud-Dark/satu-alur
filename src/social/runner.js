/**
 * Publishes social_posts rows to Meta (Facebook, Instagram, Threads). Pure: the store, account lookup and
 * fetch are injected (D1 adapter in worker/social.js). Tokens are never logged.
 * Unit test: tests/social-runner.test.mjs
 */
import { postFacebook, postInstagram, postThreads, MetaError } from './meta.js'

const MAX_ATTEMPTS = 3
const STUCK_MS = 15 * 60 * 1000
const mismatch = (name) => `Akun ${name} berubah atau terputus, jadwalkan ulang`
const STUCK = 'Status tidak pasti, periksa halaman Anda'
const GENERIC = 'Gagal memposting ke Meta.'

/**
 * Returns 'posted' | 'requeued' | 'failed', or 'skipped' when another run already claimed the row.
 * `requeue: false` (publish-now) fails transient errors instead: the user is waiting and may retry by hand.
 */
export async function publishRow(row, { store, getAccount, mediaUrl, fetchFn, now, wait, requeue = true }) {
  const nowIso = new Date(now()).toISOString()
  if (!(await store.claim(row.id, nowIso))) return 'skipped'

  let result
  try {
    const account = await getAccount(row.owner_id)
    const ig = row.platform === 'instagram'
    const th = row.platform === 'threads'
    // row.page_id holds the target account id: the Threads user for threads, the Facebook Page otherwise.
    const target = th ? account?.threads_user_id : account?.page_id
    if (!target || target !== row.page_id || (ig && !account.ig_user_id)) {
      await store.markFailed(row.id, mismatch(th ? 'Threads' : 'Facebook'))
      return 'failed'
    }
    const imageUrl = row.image_key ? mediaUrl(row.image_key) : undefined
    const text = row.content || ''
    if (th) result = await postThreads({ threadsUserId: target, token: account.threadsToken, text, imageUrl, wait }, fetchFn)
    else if (ig) result = await postInstagram({ igUserId: account.ig_user_id, pageToken: account.pageToken, caption: text, imageUrl, wait }, fetchFn)
    else result = await postFacebook({ pageId: target, pageToken: account.pageToken, message: text, imageUrl }, fetchFn)
  } catch (err) {
    if (!(err instanceof MetaError)) {
      console.error('Social publish failed', err?.name) // name only: the message could carry request data
      await store.markFailed(row.id, GENERIC)
      return 'failed'
    }
    if (err.ambiguous) {
      await store.markFailed(row.id, STUCK)
      return 'failed'
    }
    if (requeue && err.kind === 'transient' && (row.attempts || 0) + 1 < MAX_ATTEMPTS) {
      await store.requeue(row.id, err.message)
      return 'requeued'
    }
    if (err.kind === 'token') await store.flagReconnect(row.owner_id, row.platform)
    await store.markFailed(row.id, err.message)
    return 'failed'
  }
  // Outside the try: the post exists now, so a store error must not turn into a retry (the stuck sweep handles it).
  await store.markPosted(row.id, { platform_post_id: result.id ?? null, permalink: result.permalink ?? null, published_at: nowIso })
  return 'posted'
}

export async function runDue(deps, limit = 15) {
  const tally = { posted: 0, failed: 0, requeued: 0 }
  const rows = await deps.store.listDue(new Date(deps.now()).toISOString(), limit)
  for (const row of rows) {
    try {
      const r = await publishRow(row, deps)
      if (r in tally) tally[r]++
    } catch (err) {
      console.error('Social runDue row failed', err?.name) // one bad row must not stop the rest
    }
  }
  return tally
}

/** Rows left in 'publishing' (crash mid-post) may or may not be live: fail them, never retry. */
export async function sweepStuck({ store, now }) {
  const rows = await store.listStuck(new Date(now() - STUCK_MS).toISOString())
  for (const row of rows) await store.markFailed(row.id, STUCK)
  return rows.length
}
