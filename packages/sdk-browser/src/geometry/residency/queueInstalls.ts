// The installs of the streaming (`queue.ts`): each STREAMING PAGE started handed to the pool once
// its pages' bytes are in, in the order started, a count of them a frame, and what its landing or
// its failure leaves.
import type { GpuPageCache } from '../pages/pool/pages.ts'
import type { PageRec } from '../selection/types.ts'
import { pageAddress } from '../rows/page/pageSlots.ts'
import { isCancelled } from '../../session/engine/common.ts'
import type { QueueState, Started } from './queueState.ts'
import { dependOn, letGo, residentAddress, takeDesired, unloadStranded } from './queueHold.ts'

/** `entry`'s pages handed to the pool, each into its streaming page's slot — the first written over
 *  its victim's, or into a free one (`../pages/pool/placement.ts`) —, pinned when it is the root
 *  cover's. It lands once every page did; one that fails fails it. */
export function install(s: QueueState, cache: GpuPageCache, entry: Started) {
  const { signal } = s.o
  const victim = entry.victim?.address
  const loads = entry.pages.map((page) =>
    cache.load(pageAddress(page), signal, entry.cover, undefined, victim),
  )
  const load: Promise<void> = Promise.allSettled(loads)
    .then((settled) => {
      const failure = settled.find(
        (each): each is PromiseRejectedResult => each.status === 'rejected',
      )
      if (failure) missed(s, entry, failure.reason)
      else landed(s, entry)
    })
    .finally(() => {
      s.loads.delete(load)
      freed(s, entry)
    })
  s.loads.add(load)
}

/** `entry` settled: a free slot or root grain it was to take is counted free again — taken, or
 *  never. */
function freed(s: QueueState, entry: Started) {
  if (s.cache !== entry.cache) return
  if (entry.onFree) s.onFree--
  if (entry.onGrain) s.onGrain--
}

/** `entry`'s streaming page landed: resident where the use order holds it. */
function landed(s: QueueState, entry: Started) {
  if (s.cache !== entry.cache) return
  if (entry.cover) s.covering.delete(entry.unit)
  else s.o.sets.streamed.landed(entry.unit)
  keepVictim(s, entry)
}

/** `entry`'s victim still resident — its slot was not taken, its pages pinned meanwhile or the
 *  arrival's streaming page holding a slot already —: back at the use order's head, the first to
 *  give up again. */
function keepVictim(s: QueueState, entry: Started) {
  const { sets } = s.o,
    { victim, cache } = entry
  if (!victim || sets.streamed.has(victim.unit)) return
  if (residentAddress(s, cache, victim.unit) === undefined) return
  sets.streamed.restore(victim.unit, victim.page)
  dependOn(s, victim.unit, 1)
  takeDesired(s, victim.unit)
}

/**
 * `entry`'s streaming page never came whole: its start ends, the pages of it that landed let go
 * with it, its victim kept. A loss withdraws the device and ends the loop; a cancellation is no
 * failure; a pool that had no slot after all leaves it to a later update; any other failure is the
 * streaming page's for good — never started again — and said.
 */
function missed(s: QueueState, entry: Started, error: unknown) {
  if (s.cache !== entry.cache) return
  if (entry.cover) s.covering.delete(entry.unit)
  else {
    letGo(s, entry.unit)
    unloadStranded(s, entry.cache, entry.unit)
  }
  keepVictim(s, entry)
  if (/LOST|DISPOSED/i.test(String(error))) {
    // The withdrawal precedes the report: a host reading the canvas finds nothing stale.
    s.lost ??= error
    s.o.markLost(error)
    s.o.diagnosticFailure('coverage-upload-failed', error)
    return
  }
  if (isCancelled(s.o.signal) || String(error).includes('POOL_FULL')) return
  s.refused.add(entry.unit)
  s.o.diagnosticFailure('coverage-upload-failed', error)
}

/** The install loop, started when there is work and none runs. */
export function pumpOn(s: QueueState) {
  if (s.pumping || (!s.pending.length && !s.loads.size)) return
  s.pumping = true
  s.pump = run(s)
  void s.pump.catch(() => {})
}

/** Refills the frame's installs at each new frame, `maxInstallsPerFrame` streaming pages, and
 *  returns the installs left to it now. */
function refillInstalls(s: QueueState) {
  if (s.installFrame !== s.gate.count) {
    s.installFrame = s.gate.count
    s.installsLeft = s.limits.maxInstallsPerFrame
  }
  return s.installsLeft
}

/** Whether every page of `entry` has its bytes at hand: its reads done, or served from memory. */
const bytesIn = (s: QueueState, entry: Started) =>
  entry.read ? entry.ready : entry.pages.every(s.o.hasBytes)

/** The pages the started streaming pages wait on that no read serves, in the order started: the
 *  host gives their bytes (`hasBytes`), and until it does the pump stops on them (`run`). */
export function hostPages(s: QueueState): PageRec[] {
  const pages: PageRec[] = []
  for (const entry of s.pending)
    if (!entry.read) for (const page of entry.pages) if (!s.o.hasBytes(page)) pages.push(page)
  return pages
}

/** Hands the started streaming pages to the pool in the order started, each once its pages'
 *  bytes are in, at most the frame's installs; ends once none is started nor loading. A page whose
 *  bytes the host has not given yet ends it too: that page and those after it stay started, in
 *  their order, and the next update (`pumpOn`) looks again — nothing waits on the host, no loop
 *  spins on it. */
async function run(s: QueueState) {
  try {
    for (;;) {
      if (s.lost !== undefined) throw s.lost
      const head = s.pending[0]
      if (!head) {
        if (!s.loads.size) return
        await Promise.all(s.loads)
        continue
      }
      if (head.failed) {
        s.pending.shift()
        missed(s, head, head.error)
        freed(s, head)
        continue
      }
      if (!bytesIn(s, head)) {
        // A read in flight settles the page; bytes the host holds back are for a later update.
        if (!head.read && !s.loads.size) return
        await (head.read ?? Promise.all(s.loads))
        continue
      }
      if (refillInstalls(s) === 0) {
        await s.gate.next()
        continue
      }
      s.pending.shift()
      s.installsLeft--
      install(s, head.cache, head)
    }
  } finally {
    s.pumping = false
  }
}
