// The streaming queue's options, its limits and its state (`queue.ts`): what an update reads and
// writes from one frame to the next, by STREAMING PAGE (`pageUnits.ts`).
import type { PageRec } from '../selection/types.ts'
import type { GpuCut } from '../../gpu/core/selection.ts'
import type { GpuPageCache } from '../pages/pool/pages.ts'
import type { WebgpuDiagnosticChannel } from '../../frame/io/diagnostics.ts'
import type { WebgpuPageTracking } from '../rows/page/pageTracking.ts'
import type { GroupClosure } from '../cut/groupClosure.ts'
import type { PageList } from '../selection/catalogue.ts'
import type { WebgpuResidencySets } from './sets.ts'
import {
  STREAMING_RULES,
  type StreamingOptions,
} from '../../../../sdk-core/src/contracts/streamingOptions.ts'
import { readSetting } from '../../../../sdk-core/src/contracts/settingRules.ts'
import { createFrameGate } from '../integration/frameBudget.ts'
import { createPageRequests } from './pageRequests.ts'
import { createPoolPressure } from './poolPressure.ts'

export type QueueOptions = {
  tracking: WebgpuPageTracking
  sets: WebgpuResidencySets
  /** The groups a request's cut rule needs, up to the roots: what it depends on. */
  closure: Pick<GroupClosure, 'closeOver'>
  /** The packed catalogue the readbacks' ids resolve in. */
  packedPages: PageList
  /** The streaming's settings (`streamingOptions.ts`): the session's context, which
   *  `setStreaming` writes; each update reads them again (`limitsOf`). */
  settings: StreamingOptions
  /** The streaming pool's slots — a streaming page each — past the root cover. */
  streamingSlots: () => number
  getCache: () => GpuPageCache | undefined
  getFrame: () => number
  isLost: () => boolean
  /** The root cover's pins, followed before each update (`pinUpdater.ts`). */
  updatePins: () => void
  /** The pages a page depends on (`../selection/pageParents.ts`). */
  parentsOf: (page: PageRec) => readonly PageRec[]
  /** Whether the bytes the pool uploads for a page served from memory are at hand. */
  hasBytes: (page: PageRec) => boolean
  /** Starts the read of the bytes the pool uploads for `page`, which its load joins; none for a
   *  page served from memory (`hasBytes`). */
  read: (page: PageRec, signal: AbortSignal | undefined) => Promise<unknown> | undefined
  /** The rank of a page a later holder brought into the root cover: the lowest loaded first. */
  coverRank: (page: PageRec) => number
  signal?: AbortSignal
  markLost: (error: unknown) => void
  traceEnabled: boolean
  traceDiagnostic: WebgpuDiagnosticChannel['traceDiagnostic']
  diagnosticFailure: WebgpuDiagnosticChannel['diagnosticFailure']
}

/** A streaming page a victim walk gave up (`queueStarts.ts`, `victims`): its number, the address
 *  of one of its pages the pool still holds — the slot the arrival takes —, and its record. */
export type Victim = { unit: number; address: string; page: PageRec }

/**
 * A streaming page started: its number, its pages' records, the streaming page whose slot
 * it takes (`victim`, none for a free slot or the slot its pages already hold), whether it took a
 * free slot (`onFree`) or a free root grain (`onGrain`), whether it is a root-cover page — pinned
 * on arrival, outside the pending
 * bound —, the pool it was started on, its pages' reads — settled once their bytes are in
 * (`ready`) or one failed for good (`failed`, `error`) —, none for pages served from memory.
 */
export type Started = {
  unit: number
  pages: readonly PageRec[]
  victim: Victim | undefined
  onFree: boolean
  onGrain: boolean
  cover: boolean
  cache: GpuPageCache
  read: Promise<void> | undefined
  ready: boolean
  failed: boolean
  error: unknown
}

/** The limits an update runs by, in streaming pages: each setting read by its one resolver, the
 *  installs never more than may be pending, the high mark of the pool's load never under its low
 *  mark. */
export function limitsOf(settings: StreamingOptions) {
  const read = <F extends keyof typeof STREAMING_RULES>(field: F) =>
    readSetting(STREAMING_RULES, settings, field)
  const maxPendingPages = read('streamingMaxPendingPages'),
    minPoolPercent = read('streamingQualityMinPoolPercent')
  return {
    maxPendingPages,
    maxInstallsPerFrame: Math.min(read('streamingMaxInstallsPerFrame'), maxPendingPages),
    minPoolPercent,
    maxPoolPercent: Math.max(minPoolPercent, read('streamingQualityMaxPoolPercent')),
    minScale: read('streamingQualityMinScale'),
  }
}

export type QueueState = ReturnType<typeof createQueueState>

/** The views' readbacks an update reads: each view's last adopted, a drawn capture's apart — its
 *  requests first (#268) — (`../cut/adoption/publication.ts`, `viewReadbacks`). */
export type ViewReadbacks = {
  readonly cuts: readonly GpuCut[]
  readonly first: GpuCut | null
}

export function createQueueState(o: QueueOptions) {
  const { tracking, sets } = o
  return {
    o,
    /** The pool the streaming holds pages of: another one lets them all go (`reset`). */
    cache: undefined as GpuPageCache | undefined,
    /** The readbacks the last requests were read from: an update reads them again only once one
     *  of them is another. */
    readFirst: null as GpuCut | null,
    readCuts: [] as readonly GpuCut[],
    requests: createPageRequests({
      packedPages: o.packedPages,
      keyOf: tracking.keyOf,
      unitOf: tracking.units.of,
      covers: sets.covers,
      closure: o.closure,
    }),
    /** The limits the last update read (`limitsOf`). */
    limits: limitsOf(o.settings),
    pressure: createPoolPressure(),
    /** The engine's frames, which pace the installs (`createFrameGate`). */
    gate: createFrameGate(),
    /** Streaming pages started whose install is not handed to the pool yet, in the order
     *  started. */
    pending: [] as Started[],
    /** Loads handed to the pool and not settled: they never reject. */
    loads: new Set<Promise<void>>(),
    /** Started streaming pages that take a free slot, until their load settles. */
    onFree: 0,
    /** Started root pages that take a free root grain, until their load settles. */
    onGrain: 0,
    /** The root pages the last update found no root grain for: the root region grows for them
     *  (`../../frame/io/memory.ts`, `growWebgpuRootRegion`). */
    rootsShort: 0,
    /** Root-cover streaming pages whose load runs. */
    covering: new Set<number>(),
    /** Streaming pages whose bytes failed for good: never started again by this session. */
    refused: new Set<number>(),
    /** The frame the installs left were counted for, and how many it has left. */
    installFrame: -1,
    installsLeft: 0,
    /** The last update left streaming pages it would have started but for the pending bound. */
    more: false,
    /** The install loop and whether it runs (`pump`). */
    pump: undefined as Promise<void> | undefined,
    pumping: false,
    /** The failure that withdrew the device: the loop ends on it. */
    lost: undefined as unknown,
    /** Each requested streaming page's priority, by its place in the requests (`highest`). */
    ranks: new Float64Array(64),
    /** Streaming pages the last update started, for its trace. */
    started: 0,
  }
}
