import type { PageQueue } from '../../streaming/types.ts'
import { createFrameKept } from '../../streaming/frameKept.ts'
import { PRIORITY_VISIBLE } from '../../streaming/priority.ts'

/** Who hears a read the view asks land or fail, once, as it settles. */
export type AskHeard = { land(url: string, bytes: Uint8Array): void; fail(error: unknown): void }

/** What the asker reads with and holds by: the streamer's read and its counted pin. */
type Io = Pick<PageQueue, 'readBytes'> & { pin(url: string): void; unpin(url: string): void }

/** A read the view asks: what lets it go, its landing, and whether it settled. */
type Ask = { url: string; stop: AbortController; read: Promise<void>; settled: boolean }

/**
 * The reads the frames' view asks of `io` at the visible priority, one asker a url, each with a
 * signal of its own and one pin in the cache: a url the next frame asks again keeps its read and its
 * page, one it no longer asks is let go and unpinned, so the queue drops it while it
 * waits, its failure's wait included. A page landed therefore waits in the cache, whatever the
 * cache holds, for the frame that takes it. A frame waits on the reads it asks, whether they are new
 * or on their way since an earlier frame. One asked again after its read settled is read again.
 *
 * THE ONE ASKER OF THE VIEW'S READS: the cells' (`partitionFrame.ts`) and the engine's missing
 * pages (`streaming.ts`) alike, one cancel rule — only what left the plan is let go
 * (`../../streaming/frameKept.ts`).
 *
 * Cost: O(u) a frame for the u urls it asks, O(a) for the a asks it holds; nothing per landing.
 */
export function createViewAsks(io: Io) {
  let reason: unknown
  const asks = createFrameKept<string, Ask>((own) => {
    own.stop.abort(reason)
    io.unpin(own.url)
  })
  return {
    /** Asks `urls` in the frame under way: their landings, settled either way; `heard` hears each
     *  read made now land or fail. */
    ask(urls: readonly string[], heard?: AskHeard) {
      const reads: Promise<void>[] = []
      for (const url of urls) {
        let own = asks.touch(url)
        if (!own || own.settled) {
          const stop = new AbortController()
          const ask: Ask = { url, stop, read: Promise.resolve(), settled: false }
          const settle = () => void (ask.settled = true)
          ask.read = io.readBytes(url, stop.signal, PRIORITY_VISIBLE).then(
            (bytes) => {
              settle()
              if (!stop.signal.aborted) heard?.land(url, bytes)
            },
            (error) => {
              settle()
              if (!stop.signal.aborted) heard?.fail(error)
            },
          )
          // Read again once settled, the page keeps its one pin.
          if (!own) io.pin(url)
          asks.set(url, (own = ask))
        }
        reads.push(own.read)
      }
      return reads
    },
    /** Every read let go, for `why`: the asker is closed. */
    drop(why: unknown) {
      reason = why
      asks.clear()
      reason = undefined
    },
    /** The frame is over: the reads it did not ask again are let go. */
    end: asks.end,
  }
}
