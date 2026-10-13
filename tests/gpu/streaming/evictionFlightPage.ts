// Page of the eviction-flight proof: a camera flies down a generated world larger than its pool, on
// Dawn, through the engine's own GPU cut (`createGpuDagSelection`), page pool (`createGpuPageCache`),
// eviction feed (`createEvictionFeed`), install order (`createPageAdmission`) and group closure —
// loads landing between frames, at random delays, two frames read back behind. Each frame copies
// the pool in its own command buffer, after its cut: what that frame read, whatever lands after
// it. The proof reads, for every frame whose readback came: the pages it drew, the slots its tables
// named them at, the pool as it read it, and the cut an unbounded pool draws at the same pose.
import { createGpuDagSelection } from '../../../packages/sdk-browser/src/gpu/dag/selection.ts'
import { createGpuPageCache } from '../../../packages/sdk-browser/src/gpu/page/pages.ts'
import { createEvictionFeed } from '../../../packages/sdk-browser/src/webgpu/residency/evictionFeed.ts'
import { createWebgpuPageTracking } from '../../../packages/sdk-browser/src/webgpu/row/pageTracking.ts'
import { createPageAdmission } from '../../../packages/sdk-browser/src/webgpu/residency/admission.ts'
import { createPageParents } from '../../../packages/sdk-browser/src/page/selection/pageParents.ts'
import { createGroupClosure } from '../../../packages/sdk-browser/src/page/cut/groupClosure.ts'
import { pageResidency } from '../../../packages/sdk-browser/src/gpu/dag/readiness.fixture.ts'
import { packDagSelection } from '../../../packages/sdk-browser/src/gpu/dag/selection.ts'
import { pageAddress } from '../../../packages/sdk-browser/src/webgpu/row/pageSlots.ts'
import type { GpuCut } from '../../../packages/sdk-browser/src/gpu/core/selection.ts'
import { lcgRandom } from '../../../packages/math/src/sequence/random.ts'
import { openGpuDevice } from '../kit/webgpuDevice.ts'
import { animationFrame } from '../kit/frame.ts'
import { evictionWorld } from './evictionWorld.ts'

/** Words of a page's bytes: its rank, its complement, and two more. */
const PAGE_WORDS = 4

/** What one frame read back says. */
export type FlightFrame = {
  frame: number
  /** Drawn pages, increasing. */
  drawn: number[]
  /** Drawn pages whose slot did not hold their bytes when the frame read it, or that its
   *  residency did not name. */
  torn: number[]
  /** Leaf units, by copy, the cut covers zero times where the unbounded pool's covers them, or
   *  twice. */
  holes: number
  overdraw: number
  /** Pages the unbounded pool draws at this pose. */
  reference: number[]
  /** Pages resident, and the closure of what the cut asks for. */
  resident: number
  wanted: number
}

/** The flight: a row of DAGs four times the pool, flown in `flight` frames, then held still. */
const FLIGHT = { copies: 16, slots: 360, flight: 160, hold: 40, seed: 0xf1197 }

export async function runEvictionFlight(options: typeof FLIGHT = FLIGHT) {
  const gpu = await openGpuDevice()
  if (!gpu) return { unavailable: 'no WebGPU adapter' }
  const { device } = gpu
  const world = evictionWorld(options.copies)
  const { packed, pages, roots, placement, units, copyOf } = world
  const reference = packDagSelection(roots)
  const [selection, unbounded] = await Promise.all([
    createGpuDagSelection(device, packed),
    createGpuDagSelection(device, reference),
  ])
  if (!selection || !unbounded) return { error: 'GPU_SELECTION_UNAVAILABLE', errors: gpu.errors }
  unbounded.updateResidency(pageResidency(new Uint8Array(reference.pageCount).fill(1)))
  const next = lcgRandom(options.seed),
    rankOfAddress = new Map(pages.map((rec, rank) => [pageAddress(rec), rank])),
    rankOf = new Map(pages.map((rec, rank) => [rec, rank]))
  // Each page's bytes name it; they land at random delays, between frames.
  const source = {
    read: (key: string) =>
      new Promise<Uint8Array>((done) => {
        const rank = rankOfAddress.get(key)!
        const words = Uint32Array.of(rank, ~rank >>> 0, 0x5157, rank ^ 0xa5a5)
        setTimeout(() => done(new Uint8Array(words.buffer)), Math.floor(next() * 40))
      }),
  }
  const tracking = createWebgpuPageTracking(pages)
  const bootstrapKey = new Uint8Array(tracking.keyCount),
    cover: string[] = []
  roots.forEach((root, r) =>
    root.pages.forEach((rec, p) => {
      if ((root.structure?.owners[p] ?? -1) >= 0) return
      bootstrapKey[tracking.keyOf(rec as never)] = 1
      cover.push(pageAddress(pages[placement.baseOfRoot[r] + p]))
    }),
  )
  const cache = createGpuPageCache(device, source, {
    pageBytes: PAGE_WORDS * 4,
    slots: options.slots,
    cover: new Set(cover),
  })
  await Promise.all(cover.map((address) => cache.load(address, undefined, true)))
  const admit = createPageAdmission({
    getCache: () => cache,
    tracking,
    bootstrapKey,
    isLost: () => false,
    hasBytes: () => true,
    parentsOf: createPageParents(roots as never, placement, (rec) => rankOf.get(rec) ?? -1),
  })
  const closure = createGroupClosure(roots as never, placement, pages)
  const feed = createEvictionFeed(pages, () => cache)
  /** What each submitted frame named and read: its residency, its slots, its pool. */
  const submitted = new Map<number, { flags: Uint8Array; offsets: Int32Array; pool: GPUBuffer }>()
  const frames: FlightFrame[] = [],
    checks: Promise<void>[] = [],
    references = new Map<number, number[]>()
  let wanted: GpuCut['result']['pageIds'] = [],
    wantedCount = 0,
    loading = false,
    landed: unknown = null,
    evictions = 0
  /** The pages the latest readback asks for, closed over their groups, loaded in install order. */
  const load = async () => {
    if (loading) return
    loading = true
    try {
      const held = new Set<number>()
      closure.closeOver(wanted, (id) => void held.add(id))
      wantedCount = held.size
      for (const id of held) {
        if (cache.get(pageAddress(pages[id]))) continue
        try {
          await admit(pages[id])
        } catch (error) {
          if (String(error).includes('POOL_FULL')) break
          throw error
        }
      }
    } finally {
      loading = false
    }
  }
  /** Frame `frame`'s readback: its drawn pages against the pool it read, and the unbounded cut. */
  const check = async (cut: GpuCut) => {
    const frame = cut.uniforms.frame!,
      at = submitted.get(frame)
    if (!at) return
    submitted.delete(frame)
    for (const [older, gone] of submitted)
      if (older < frame) (gone.pool.destroy(), submitted.delete(older))
    await at.pool.mapAsync(GPUMapMode.READ)
    const words = new Uint32Array(at.pool.getMappedRange().slice(0))
    at.pool.destroy()
    const drawn = [...(cut.result.drawablePageIds ?? [])].sort((a, b) => a - b)
    const torn = drawn.filter((page) => {
      const offset = at.offsets[page]
      return (
        !at.flags[page] || offset < 0 || words[offset] !== page || words[offset + 1] !== ~page >>> 0
      )
    })
    const ref = references.get(frame) ?? []
    const covered = (list: readonly number[]) => {
      const hits = new Map<number, number>()
      for (const page of list)
        for (let u = units[page][0]; u < units[page][1]; u++) {
          const unit = copyOf(page) * world.dag.leaves + u
          hits.set(unit, (hits.get(unit) ?? 0) + 1)
        }
      return hits
    }
    const got = covered(drawn),
      want = covered(ref)
    let holes = 0,
      overdraw = 0
    for (const unit of want.keys()) if (!got.has(unit)) holes++
    for (const n of got.values()) if (n > 1) overdraw++
    frames.push({
      frame,
      drawn,
      torn,
      holes,
      overdraw,
      reference: ref,
      resident: cache.residentPages,
      wanted: wantedCount,
    })
  }
  try {
    const total = options.flight + options.hold
    for (let f = 0; f < total; f++) {
      await animationFrame()
      const frame = f + 10,
        x = (Math.min(f, options.flight) * ((options.copies - 2) * world.spacing)) / options.flight
      const uniforms = world.view(x, selection)
      reference.worlds.set(packed.worlds)
      unbounded.updateWorlds(reference.worlds)
      unbounded.dispatch({ ...uniforms, frame })
      const truth = await unbounded.flush()
      references.set(
        frame,
        [...(truth?.drawablePageIds ?? [])].sort((a, b) => a - b),
      )
      feed(selection, frame)
      // The pool's changes since the last frame, as the host mirrors them.
      const keys: string[] = [],
        offsets: number[] = []
      cache.drainResidencyChanges(keys, offsets)
      keys.forEach((key, i) => {
        if (offsets[i] < 0) evictions++
        selection.notePool(rankOfAddress.get(key)!, offsets[i] >= 0 && !cache.isPinned(key))
      })
      const flags = new Uint8Array(packed.pageCount),
        slots = new Int32Array(packed.pageCount).fill(-1)
      pages.forEach((rec, page) => {
        const held = cache.get(pageAddress(rec))
        if (!held) return
        flags[page] = 1
        slots[page] = held.offset / 4
      })
      selection.updateResidency(pageResidency(flags))
      const encoder = device.createCommandEncoder()
      const settle = selection.dispatch({ ...uniforms, frame }, encoder)
      const pool = device.createBuffer({
        size: cache.buffer.size,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
      })
      encoder.copyBufferToBuffer(cache.buffer, 0, pool, 0, cache.buffer.size)
      device.queue.submit([encoder.finish()])
      settle?.(true)
      submitted.set(frame, { flags, offsets: slots, pool })
      const cut = selection.peek()
      if (cut && cut !== landed) {
        landed = cut
        checks.push(check(cut))
        wanted = cut.result.pageIds
        void load()
      }
    }
    await Promise.all(checks)
  } catch (error) {
    return { error: String(error) + ((error as Error).stack ?? ''), frames, errors: gpu.errors }
  } finally {
    for (const { pool } of submitted.values()) pool.destroy()
    selection.dispose()
    unbounded.dispose()
    await cache.dispose()
  }
  const { court: adapter } = await gpu.fermer()
  return {
    adapter,
    frames,
    evictions,
    pages: packed.pageCount,
    slots: options.slots,
    flight: options.flight,
    /** Each page's level, its copy's leaf units and its copy: what a dip in detail is read by. */
    levels: pages.map((rec) => rec.level ?? 0),
    units,
    copies: pages.map((_, page) => copyOf(page)),
    leaves: world.dag.leaves,
    errors: gpu.errors,
  }
}
