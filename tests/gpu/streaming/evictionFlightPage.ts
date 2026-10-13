// Page of the eviction-flight proof: a camera flies down a generated world larger than its pool, on
// Dawn, through the engine's own GPU cut, page pool, eviction feed, install order and group closure,
// loads landing between frames at random delays, two frames read back behind. Each frame copies the
// pool in its own command buffer after its cut: what it read, whatever lands after. Read for every
// frame whose readback came (`evictionFlightFrame.ts`): its drawn pages, the slots its tables named
// them at, the pool as it read it, and the cut an unbounded pool draws at the same pose.
import {
  createGpuDagSelection,
  packDagSelection,
} from '../../../packages/sdk-browser/src/gpu/dag/selection.ts'
import { createGpuPageCache } from '../../../packages/sdk-browser/src/gpu/page/pages.ts'
import { createEvictionFeed } from '../../../packages/sdk-browser/src/webgpu/residency/evictionFeed.ts'
import { createWebgpuPageTracking } from '../../../packages/sdk-browser/src/webgpu/row/pageTracking.ts'
import { createPageAdmission } from '../../../packages/sdk-browser/src/webgpu/residency/admission.ts'
import { createPageParents } from '../../../packages/sdk-browser/src/page/selection/pageParents.ts'
import { createGroupClosure } from '../../../packages/sdk-browser/src/page/cut/groupClosure.ts'
import { pageResidency } from '../../../packages/sdk-browser/src/gpu/dag/readiness.fixture.ts'
import { pageAddress } from '../../../packages/sdk-browser/src/webgpu/row/pageSlots.ts'
import type { GpuCut } from '../../../packages/sdk-browser/src/gpu/core/selection.ts'
import { lcgRandom } from '../../../packages/math/src/sequence/random.ts'
import { openGpuDevice } from '../kit/webgpuDevice.ts'
import { animationFrame } from '../kit/frame.ts'
import { PAGE_BYTES, evictionWorld } from './evictionWorld.ts'
import { readFlightFrame, type FlightFrame } from './evictionFlightFrame.ts'

/** The flight: a row of DAGs twenty times the pool, flown in `flight` frames, then held still. */
const FLIGHT = { copies: 16, slots: 72, flight: 160, hold: 40, seed: 0xf1197 }

export async function runEvictionFlight(options: typeof FLIGHT = FLIGHT) {
  const gpu = await openGpuDevice()
  if (!gpu) return { unavailable: 'no WebGPU adapter' }
  const { device } = gpu
  const world = evictionWorld(options.copies)
  const { packed, pages, roots, placement } = world
  const reference = packDagSelection(roots)
  const [selection, unbounded] = await Promise.all([
    createGpuDagSelection(device, packed),
    createGpuDagSelection(device, reference),
  ])
  if (!selection || !unbounded) return { error: 'GPU_SELECTION_UNAVAILABLE', errors: gpu.errors }
  unbounded.updateResidency(pageResidency(new Uint8Array(reference.pageCount).fill(1)))
  const { rankOfAddress } = world,
    rankOf = new Map(pages.map((rec, rank) => [rec, rank])),
    source = world.source(lcgRandom(options.seed))
  const tracking = createWebgpuPageTracking(pages),
    bootstrapKey = new Uint8Array(tracking.keyCount),
    { cover } = world
  for (const address of cover) bootstrapKey[tracking.pageCatalogIds.get(address)!] = 1
  const cache = createGpuPageCache(device, source, {
    pageBytes: PAGE_BYTES,
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
    job: Promise<void> = Promise.resolve(),
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
    for (const [older, gone] of submitted) {
      if (older >= frame) continue
      gone.pool.destroy()
      submitted.delete(older)
    }
    await at.pool.mapAsync(GPUMapMode.READ)
    const words = new Uint32Array(at.pool.getMappedRange().slice(0))
    at.pool.destroy()
    const drawn = [...(cut.result.drawablePageIds ?? [])].sort((a, b) => a - b),
      ref = references.get(frame) ?? []
    const { torn, holes, overdraw } = readFlightFrame(world, drawn, ref, at, words)
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
        if (!loading) job = load()
      }
    }
    await Promise.all([...checks, job])
  } catch (error) {
    return { error: String(error) + ((error as Error).stack ?? ''), frames, errors: gpu.errors }
  } finally {
    await job.catch(() => {})
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
    units: world.units,
    copies: pages.map((_, page) => world.copyOf(page)),
    leaves: world.dag.leaves,
    errors: gpu.errors,
  }
}
