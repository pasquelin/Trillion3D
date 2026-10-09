import type { PageQueue } from '../../streaming/types.ts'

/** A read the view asks: what lets it go, its priority, its landing, whether it settled, and the
 *  frame that last asked it. */
type Ask = {
  stop: AbortController
  priority: number
  read: Promise<void>
  settled: boolean
  frame: number
}

/**
 * The reads the frames' view asks of `queue`, one asker a url, each with a signal of its own: a
 * url the next frame asks again keeps its read — lifted once it turns visible —, one it no longer
 * asks is let go, so the queue drops it while it waits, its failure's wait included. A frame waits
 * on the reads it asks, whether they are new or on their way since an earlier frame. One asked
 * again after its read settled — its page evicted before it was taken — is read again only once a
 * frame went by with no page evicted, nor any since (`stats().evictions`): while the cache has no room, it would
 * be read for nothing, and read again by every frame.
 *
 * Cost: O(u) a frame for the u urls it asks, O(a) for the a asks it ends; nothing per landing.
 */
export function createViewAsks(
  queue: Pick<PageQueue, 'readBytes'> & { stats?: () => { evictions: number } },
) {
  const asks = new Map<string, Ask>()
  const evictions = () => queue.stats?.().evictions ?? 0
  let frame = 0,
    /** The evictions counted at the last frame's end, and at the one before. */
    endedAt = evictions(),
    endedBefore = endedAt
  /** Whether the cache evicted nothing over the last frame, nor since: room for a page read again. */
  const roomy = () => endedAt === endedBefore && evictions() === endedAt
  return {
    /** Asks `urls` at `priority` in the frame under way: their landings, settled either way. */
    ask(urls: readonly string[], priority: number) {
      const reads: Promise<void>[] = []
      for (const url of urls) {
        let own = asks.get(url)
        const again = !!own?.settled
        if (!own || (again && roomy()) || priority < own.priority) {
          const stop = new AbortController()
          const ask: Ask = { stop, priority, read: Promise.resolve(), settled: false, frame }
          const settle = () => void (ask.settled = true)
          ask.read = queue.readBytes(url, stop.signal, priority).then(settle, settle)
          // The more urgent asker joins before the other leaves: the read is lifted, never dropped.
          own?.stop.abort()
          asks.set(url, (own = ask))
        }
        own.frame = frame
        // A read held back waits on nothing: the frame is drawn again once a page lands.
        if (!own.settled || !again) reads.push(own.read)
      }
      return reads
    },
    /** The frame is over: the reads it did not ask again are let go. */
    end() {
      for (const [url, own] of asks)
        if (own.frame !== frame) {
          own.stop.abort()
          asks.delete(url)
        }
      frame++
      endedBefore = endedAt
      endedAt = evictions()
    },
  }
}
