import { PRIORITY_VISIBLE } from './priority.ts'
import { microtaskOnce } from '../../../sdk-core/src/runtime/microtaskOnce.ts'
import { countBy } from '../../../math/src/sequence/counts.ts'

type Watch = { reading: Map<string, number>; landed: Set<string>; heard: () => void }

/**
 * Every page read of a streamer passes here (`read`), whoever asks it: the host's own batches and
 * the reads an engine makes on its own — the WebGPU residency reads its pages one by one.
 * `watch` counts those the view waits on — a prefetch, read behind them, is not — while it runs,
 * each page once: asked when its first read starts, landed when one resolves; a page whose every
 * read was dropped before landing is no longer asked. What changes within a task is heard once;
 * `landed` never goes back.
 */
export function createReadWatch(
  subscribe: (url: string, signal: AbortSignal, priority?: number) => Promise<Uint8Array>,
) {
  const watches = new Set<Watch>()
  /** Every watch hears once what changed within the task. */
  const { schedule: hear } = microtaskOnce(() => watches.forEach((watch) => watch.heard()))
  const read = (url: string, signal: AbortSignal, priority?: number) => {
    const reading = subscribe(url, signal, priority)
    if (!watches.size || (priority ?? PRIORITY_VISIBLE) > PRIORITY_VISIBLE) return reading
    let askedBy: Watch[] | undefined
    for (const watch of watches)
      if (!watch.landed.has(url)) {
        ;(askedBy ??= []).push(watch)
        countBy(watch.reading, url, 1)
      }
    // A page every watch counts as landed already changes no count: nothing to hear of it.
    if (!askedBy) return reading
    hear()
    const settle = (landed: boolean) => {
      for (const watch of askedBy!) {
        if (!landed) countBy(watch.reading, url, -1)
        else {
          watch.landed.add(url)
          watch.reading.delete(url)
        }
      }
      hear()
    }
    reading.then(
      () => settle(true),
      () => settle(false),
    )
    return reading
  }
  /** Calls `heard` as pages are read and land, until `stop`; `reads` counts them now, `hold`
   *  counts a page resident already as landed, once. */
  const watch = (heard: () => void) => {
    const entry: Watch = { reading: new Map(), landed: new Set(), heard }
    watches.add(entry)
    return {
      /** The pages read since the watch started, and those landed. */
      reads: () => ({ landed: entry.landed.size, asked: entry.landed.size + entry.reading.size }),
      hold: (url: string) => void (entry.reading.delete(url), entry.landed.add(url)),
      stop: () => void watches.delete(entry),
    }
  }
  return { read, watch }
}
