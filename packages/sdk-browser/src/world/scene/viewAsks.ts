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
 * on the reads it asks, whether they are new or on their way since an earlier frame; one asked
 * again after its read settled — its page evicted before it was taken — is read again.
 *
 * Cost: O(u) a frame for the u urls it asks, O(a) for the a asks it ends; nothing per landing.
 */
export function createViewAsks(queue: Pick<PageQueue, 'readBytes'>) {
  const asks = new Map<string, Ask>()
  let frame = 0
  return {
    /** Asks `urls` at `priority` in the frame under way: their landings, settled either way. */
    ask(urls: readonly string[], priority: number) {
      const reads: Promise<void>[] = []
      for (const url of urls) {
        let own = asks.get(url)
        if (!own || own.settled || priority < own.priority) {
          const stop = new AbortController()
          const ask: Ask = { stop, priority, read: Promise.resolve(), settled: false, frame }
          const settle = () => void (ask.settled = true)
          ask.read = queue.readBytes(url, stop.signal, priority).then(settle, settle)
          // The more urgent asker joins before the other leaves: the read is lifted, never dropped.
          own?.stop.abort()
          asks.set(url, (own = ask))
        }
        own.frame = frame
        reads.push(own.read)
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
    },
  }
}
