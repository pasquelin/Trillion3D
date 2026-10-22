import type { GpuPageCache } from '../pages/pool/pages.ts'
import {
  createQueueState,
  limitsOf,
  type QueueOptions,
  type QueueState,
  type ViewReadbacks,
} from './queueState.ts'
import { followDepartures, loadCover, start, victims } from './queueStarts.ts'
import { hostPages, paceFrame, pumpOn } from './queueInstalls.ts'

/**
 * THE STREAMING OF THE GEOMETRY POOL, once per update — an update a frame, the views' readbacks
 * read whenever one of them is new —, the root cover apart (`./sets.ts`, `covers`). Its unit is the
 * STREAMING PAGE (`./pageUnits.ts`): a compiled page of 128 KiB at most, requested, started,
 * installed, kept and given up whole, one pool slot each (`../pages/pool/placement.ts`); every
 * count below counts them.
 * 1. The requests (`./pageRequests.ts`): the streaming pages of the pages every view's readback
 *    asks for, at the GPU's priorities, the prefetches' above them (`prefetch`), and what they
 *    depend on, one higher per group; the started or resident ones move to the end of the use order
 *    (`./streamedPages.ts`), the views' requests first, in their order.
 * 2. The pool's pressure on the quality (`./poolPressure.ts`): the unique requests against the
 *    streaming pool's slots.
 * 3. The root cover's missing streaming pages a later holder brought are loaded, first
 *    (`loadCover`, `./queueStarts.ts`), a root page into a free root grain: those it finds none
 *    for (`rootsShort`) wait for the root region to grow (`../../frame/io/memory.ts`,
 *    `growWebgpuRootRegion`).
 * 4. The new streaming pages — requested, neither started nor resident — highest priority first,
 *    at most `maxPendingPages` less those pending (`highest`, a heap of that many, never a sort of
 *    all): each takes a free slot, else the slot of the use order's first streaming page this
 *    update does not request, that has landed, holds no root cover and that no started or resident
 *    one depends on — let go at once, drawn until the new one is written over it. None left: the
 *    update starts no more (`start`).
 * 5. Installs (`run`, `./queueInstalls.ts`): the started streaming pages, in the order started,
 *    each once its pages' bytes are in — none passes one still waiting —, at most
 *    `maxInstallsPerFrame` a frame, and no clock but the simulated bandwidth's
 *    (`streamingBandwidthLimit`): a page costs a frame what it costs. One whose
 *    object went invalid while its bytes came — another page of it failed for good — is dropped.
 * A streaming page whose bytes fail for good is never started again; one the pool had no slot for
 * after all is asked by a later update. A loss withdraws the device and ends the loop.
 */
export function createWebgpuResidencyQueue(options: QueueOptions) {
  const s = createQueueState(options)
  return {
    /** One update over the views' readbacks: what the frame streams. */
    queueCuts: (readbacks: ViewReadbacks) => update(s, readbacks),
    /** The scale of the cut's screen error under the pool's pressure, in [`minScale`, 1]: the pixel
     *  threshold is divided by it (`../../frame/render/gpuCut.ts`). */
    get qualityScale() {
      return s.pressure.scale
    },
    /** The root pages the last update found no root grain for: the root region grows for them. */
    get rootsShort() {
      return s.rootsShort
    },
    /** Packed pages `pages` asked for the next `updates` updates that read a readback — ahead of
     *  the views' requests, the nearer the deadline the higher: an HLOD actor about to draw
     *  (`./pageRequests.ts`, `prefetch`). */
    prefetch: (pages: readonly number[], updates: number) => s.requests.prefetch(pages, updates),
    /** Settles when the pump stops: every page started is installed or failed, the root cover's
     *  included, or the head page's bytes are not in yet — the host has not given them, nothing
     *  else is loading — and the pages stay started (`busy`, `hostPages`); rejects with the loss
     *  that withdrew the device. */
    get pending(): Promise<unknown> {
      return s.pump ?? Promise.resolve()
    },
    /** The pages the started streaming pages wait on that only the host can give: no read serves
     *  them (`./queueInstalls.ts`). */
    hostPages: () => hostPages(s),
    quietPending: () => void s.pump?.catch(() => {}),
    /** True while a page is started and not installed, or the last update left pages to start:
     *  residency can still change. */
    get busy() {
      return s.pending.length > 0 || s.loads.size > 0 || s.more
    },
    /** Bytes of the update's tables, bounded by its requests. */
    get hostBytes() {
      return s.requests.byteLength + s.ranks.byteLength
    },
  }
}

function update(s: QueueState, readbacks: ViewReadbacks) {
  const { o } = s
  s.gate.frame()
  o.updatePins()
  const cache = o.getCache()
  if (!cache || o.isLost()) return
  if (cache !== s.cache) reset(s, cache)
  followDepartures(s, cache)
  s.limits = limitsOf(o.settings)
  paceFrame(s)
  const cuts = freshCuts(s, readbacks)
  if (cuts) {
    const { requests } = s,
      { streamed } = o.sets
    requests.take(cuts)
    for (let at = 0; at < requests.count; at++)
      if (streamed.has(requests.keys[at])) streamed.touch(requests.keys[at])
    const slots = o.streamingSlots()
    s.pressure.update(slots ? (requests.count / slots) * 100 : 0, s.limits)
  }
  const victim = victims(s, cache)
  loadCover(s, cache, victim)
  s.started = 0
  if (cuts) start(s, cache, victim)
  trace(s, cache)
  pumpOn(s)
}

/** The readbacks to read the requests of — the capture's first —, when one of them is new. */
function freshCuts(s: QueueState, { cuts, first }: ViewReadbacks) {
  const held =
    first === s.readFirst &&
    cuts.length === s.readCuts.length &&
    cuts.every((cut, at) => cut === s.readCuts[at])
  if (held) return undefined
  s.readFirst = first
  s.readCuts = cuts.slice()
  return first ? [first, ...cuts] : s.readCuts
}

/** Another pool: every streaming page the streaming held belonged to the one it replaces. The
 *  loads still running on that one settle on it, unheard (`landed`, `missed`). */
function reset(s: QueueState, cache: GpuPageCache) {
  const { sets, tracking } = s.o,
    { streamed } = sets
  for (let unit = streamed.first; unit >= 0; unit = streamed.next(unit))
    for (const key of tracking.units.keys(unit)) sets.drop(key)
  streamed.clear()
  s.pending.length = 0
  s.covering.clear()
  s.onFree = 0
  s.onGrain = 0
  s.rootsShort = 0
  s.pacing.installFrame = -1
  s.more = false
  s.readFirst = null
  s.readCuts = []
  s.cache = cache
}

function trace(s: QueueState, cache: GpuPageCache) {
  const { o } = s
  if (!o.traceEnabled) return
  o.traceDiagnostic('residency-queue', 'GPU residency streamed', () => ({
    frame: o.getFrame(),
    requested: s.requests.count,
    started: s.started,
    pending: s.pending.length,
    loading: s.loads.size,
    qualityScale: s.pressure.scale,
    streamed: o.sets.streamed.size,
    wanted: o.tracking.traceKeys('wanted', o.tracking.wanted),
    residentPages: cache.residentPages,
  }))
}
