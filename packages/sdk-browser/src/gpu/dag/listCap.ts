import { validationScope } from '../core/errorScope.ts'
import {
  DAG_READBACK_SLOTS,
  KEPT_HEADER_WORDS,
  OUT_COUNT,
  SELECTION_HEADER_WORDS as HEAD,
  keptSnapshotWord,
  residentReadbackBytes,
  selectionListCap,
  stagedOutputBytes,
} from './layout.ts'
import { makeDagBuffer, readoutRow } from './bufferTable.ts'
import type { createDagResources } from './resources.ts'
import type { CameraFrames } from './frameRanges.ts'
import { newRegions, regionsWanted } from './swap.ts'
import { storageBufferCap } from '../../residency/pools.ts'
import { recutMain, type DagRuntimeState } from './runtimeState.ts'
import { type Limits, deviceListCap } from './deviceListCap.ts'
type DagResources = NonNullable<Awaited<ReturnType<typeof createDagResources>>>

/** The cap a cut starts with: the readout's (`selectionListCap`, `layout.ts`), within the device. */
export const initialListCap = (limits: Limits, pageCount: number) =>
  Math.min(selectionListCap(pageCount), deviceListCap(limits))

/**
 * THE CAP A TRUNCATED READOUT GROWS TO. The list is sized for a wide cut, not for every cut: a
 * view that keeps more asks `needed` ranks — the camera's own: the view ahead has its own counter
 * and never grows the list (`shader/snapshotWgsl.ts`) —, and the list doubles past it, within the
 * catalogue and what one binding holds.
 * `undefined` when even that cannot hold the cut: the readout stays truncated and the host says
 * so; the GPU cut is the engine's one (#1483).
 */
export function grownListCap(limits: Limits, pageCount: number, cap: number, needed: number) {
  const next = Math.min(pageCount, deviceListCap(limits), 2 * Math.max(cap, needed))
  return next > cap && next >= Math.min(needed, pageCount) ? next : undefined
}

/** Ranks the cut asked of its readout, kept or not: the camera requests' counter, and the drawn
 *  list's behind them, both counted past the cap (`shader/snapshotWgsl.ts`, `shader/compactWgsl.ts`). */
export function listDemand(bytes: ArrayBuffer, drawnWordOffset: number) {
  const ints = new Uint32Array(bytes, 0, drawnWordOffset + 1)
  return Math.max(ints[OUT_COUNT], drawnWordOffset ? ints[drawnWordOffset] : 0)
}

/** The readout of a cut whose list holds `listCap` ranks and `regions` saved journals
 *  (`swap.ts`): the buffer the kernels write, and the readback slots the frame copies it into, each
 *  made by `own` (`resources.ts`). */
export function createDagList(
  own: (descriptor: GPUBufferDescriptor) => GPUBuffer,
  listCap: number,
  regions = 0,
) {
  const outputBytes = (HEAD + listCap) * 4,
    // The requests, the drawn list and one burst of the eviction queue (`EVICTION_BURST`).
    readbackBytes = residentReadbackBytes(listCap)
  // Behind the eviction queue, the requests wait for their sort, outside what the frame copies
  // (`shader/snapshotWgsl.ts`).
  const output = makeDagBuffer(own, readoutRow(listCap, regions))
  const readback = Array.from({ length: DAG_READBACK_SLOTS }, () =>
    own({
      size: readbackBytes,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    }),
  )
  return { listCap, outputBytes, readbackBytes, output, readback }
}

/**
 * Gives the camera cut a list of `listCap` ranks and `regions` saved journals, between two frames
 * and with no readback in flight: a new readout and its slots, the bind groups that name it, and
 * the old ones destroyed. Made under an out-of-memory scope, within one binding: a device that
 * cannot grant them keeps the old readout whole and says `false`, so the host falls back on the
 * next truncated readout — or the views aside cut without a region — rather than on an error of the
 * whole device. The kernels read the cap from the uniforms (`uniforms.ts`); the pool's list, in
 * `pageCones`, keeps its own (`layout.ts`).
 */
async function growDagList(
  resources: DagResources,
  listCap: number,
  regions: number,
  disposed: () => boolean,
) {
  if (stagedOutputBytes(listCap, regions) > storageBufferCap(resources.device.limits)) return false
  const made: GPUBuffer[] = []
  const make = (descriptor: GPUBufferDescriptor) => {
    const buffer = resources.device.createBuffer(descriptor)
    made.push(buffer)
    return buffer
  }
  let list: ReturnType<typeof createDagList> | undefined
  try {
    const { value, error } = await validationScope(
      resources.device,
      () => createDagList(make, listCap, regions),
      'out-of-memory',
    )
    if (!error) list = value
  } catch {
    /* A creation the device throws on is a refusal too. */
  }
  // Refused, or `dispose` came meanwhile: nothing made outlives this call.
  if (!list || disposed()) {
    for (const buffer of made) buffer.destroy()
    return false
  }
  const old = [resources.output, ...resources.readback]
  moveKeptSnapshot(resources.device, resources, list)
  Object.assign(resources, list)
  resources.buffers.push(...made)
  resources.group.out = list.output
  resources.ranges = resources.frames.bindGroups(resources.layout, resources.group)
  resources.rankGroups = rankGroups(resources)
  // The saved journals and the lists were the old readout's (`swap.ts`).
  newRegions(resources.swap, regions)
  for (const buffer of old) {
    resources.buffers.splice(resources.buffers.indexOf(buffer), 1)
    buffer.destroy()
  }
  return true
}

/**
 * The kept snapshot carried into the grown readout, lengths and both lists, each at the place the
 * new cap gives it (`keptSnapshotWord`): the next copy's difference is taken against it as if the
 * list had not grown, and the readbacks since keep naming their pages by its ranks
 * (`differenceChain.ts`). The ranks of each page stay where they are (`rankGroups`).
 */
function moveKeptSnapshot(
  device: GPUDevice,
  from: { output: GPUBuffer; listCap: number },
  to: { output: GPUBuffer; listCap: number },
) {
  const encoder = device.createCommandEncoder(),
    a = keptSnapshotWord(from.listCap) * 4,
    b = keptSnapshotWord(to.listCap) * 4,
    asked = (KEPT_HEADER_WORDS + from.listCap) * 4
  encoder.copyBufferToBuffer(from.output, a, to.output, b, asked)
  encoder.copyBufferToBuffer(
    from.output,
    a + asked,
    to.output,
    b + (KEPT_HEADER_WORDS + to.listCap) * 4,
    from.listCap * 4,
  )
  device.queue.submit([encoder.finish()])
}

/** Grows the list to `state.grow`, and `out` to the regions the views aside ask, behind the
 *  readbacks in `state.pending`; no frame cuts until it is in place or refused, and the next one
 *  cuts and reads again — on the grown list, or, refused, to hand the truncated readout to the host
 *  and draw the views aside without a region. */
function queueDagListGrowth(resources: DagResources, state: DagRuntimeState) {
  const { swap } = resources,
    cap = Math.max(state.grow, resources.listCap),
    regions = state.regionsFull ? swap.regions : Math.max(swap.regions, regionsWanted(swap))
  state.grow = 0
  state.growing = true
  state.pending = state.pending
    .catch(() => {})
    .then(async () => {
      try {
        if (await growDagList(resources, cap, regions, () => state.disposed)) return
        if (cap > resources.listCap) state.listFull = true
        if (regions > swap.regions) state.regionsFull = true
      } finally {
        state.growing = false
        recutMain(swap, state)
      }
    })
}

/** True when the list must grow, or `out` must hold the saved regions the views aside ask. */
const growthAsked = (resources: DagResources, state: DagRuntimeState) =>
  !!state.grow || (!state.regionsFull && regionsWanted(resources.swap) > resources.swap.regions)

/** True when no cut may run on the tables now: disposed, lost, or a list or regions to grow —
 *  which wait for the readbacks in flight, then grow (`queueDagListGrowth`): no frame cuts on the
 *  old ones. The main view's dispatch (`dispatch.ts`) and a view's aside (`aside.ts`) alike. */
export function tablesHeld(resources: DagResources, state: DagRuntimeState) {
  if (state.disposed || state.dead || state.growing) return true
  if (!growthAsked(resources, state)) return false
  if (!state.mapped.includes(true)) queueDagListGrowth(resources, state)
  return true
}

/** The cut's group of each kept list, its ranks where the cut binds `work`: what its difference
 *  kernels bind (`shader/differenceWgsl.ts`), made again with the ranges when `out` is. */
export function rankGroups(resources: {
  layout: GPUBindGroupLayout
  frames: Pick<CameraFrames, 'bindGroup'>
  group: Parameters<CameraFrames['bindGroup']>[1]
  ranks: GPUBuffer[]
}) {
  const { layout, frames, group } = resources
  // The first range's group alone: the difference reads no primitive's words.
  return resources.ranks.map((work) => frames.bindGroup(layout, { ...group, work }, 0))
}
