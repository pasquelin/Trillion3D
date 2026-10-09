import { validationScope } from '../core/errorScope.ts'
import {
  DAG_READBACK_SLOTS,
  KEPT_HEADER_WORDS,
  OUT_COUNT,
  SELECTION_HEADER_WORDS as HEAD,
  heldOpenWord,
  keptSnapshotWord,
  residentReadbackBytes,
  selectionListCap,
  stagedOutputBytes,
} from './layout.ts'
import { heldOpenSlots } from './heldOpen.ts'
import { makeDagBuffer, readoutRow } from './bufferTable.ts'
import type { createDagResources } from './resources.ts'
import type { CameraFrames } from './frameRanges.ts'
import { newRegions } from './swap.ts'
import { storageBufferCap } from '../../residency/pools.ts'
import { type Limits, deviceListCap } from './deviceListCap.ts'
type DagResources = NonNullable<Awaited<ReturnType<typeof createDagResources>>>

/** The cap a cut starts with: the readout's (`selectionListCap`, `layout.ts`), within the device
 *  beside the `heldSlots` slots of open counts its readout holds (`heldOpen.ts`). */
export const initialListCap = (limits: Limits, pageCount: number, heldSlots = 0) =>
  Math.min(selectionListCap(pageCount), deviceListCap(limits, heldSlots))

/**
 * The slots of the open counts a cut's placements hold (`heldOpen.ts`), for the `rows` the row
 * cache holds resident: within a quarter of what one binding leaves past the lists at their first
 * cap, so the lists — and the regions the views aside add — always come first; a table that small
 * leaves more counts at their node's, never a list short.
 */
export function cutHeldSlots(limits: Limits, pageCount: number, rows: number) {
  const lists = stagedOutputBytes(initialListCap(limits, pageCount))
  return heldOpenSlots(rows, (storageBufferCap(limits) - lists) / 4)
}

/**
 * THE CAP A TRUNCATED READOUT GROWS TO. The list is sized for a wide cut, not for every cut: a
 * view that keeps more asks `needed` ranks — the camera's own: the view ahead has its own counter
 * and never grows the list (`shader/snapshotWgsl.ts`) —, and the list doubles past it, within the
 * catalogue and what one binding holds.
 * `undefined` when even that cannot hold the cut: the cut coarsens instead (`coarsening.ts`); the GPU
 * cut is the engine's one.
 */
export function grownListCap(
  limits: Limits,
  pageCount: number,
  cap: number,
  needed: number,
  heldSlots = 0,
) {
  const next = Math.min(pageCount, deviceListCap(limits, heldSlots), 2 * Math.max(cap, needed))
  return next > cap && next >= Math.min(needed, pageCount) ? next : undefined
}

/** Ranks the cut asked of its readout, kept or not: the camera requests' counter, and the drawn
 *  list's behind them, both counted past the cap (`shader/snapshotWgsl.ts`, `shader/compactWgsl.ts`). */
export function listDemand(bytes: ArrayBuffer, drawnWordOffset: number) {
  const ints = new Uint32Array(bytes, 0, drawnWordOffset + 1)
  return Math.max(ints[OUT_COUNT], drawnWordOffset ? ints[drawnWordOffset] : 0)
}

/** The readout of a cut whose list holds `listCap` ranks and `regions` saved journals
 *  (`swap.ts`), the `heldSlots` slots of the open counts placements hold behind them
 *  (`heldOpen.ts`): the buffer the kernels write, and the readback slots the frame copies it into,
 *  each made by `own` (`resources.ts`). */
export function createDagList(
  own: (descriptor: GPUBufferDescriptor) => GPUBuffer,
  listCap: number,
  regions = 0,
  heldSlots = 0,
) {
  const outputBytes = (HEAD + listCap) * 4,
    // The requests, the drawn list and one burst of the eviction queue (`EVICTION_BURST`).
    readbackBytes = residentReadbackBytes(listCap)
  // Behind the eviction queue, the requests wait for their sort, outside what the frame copies
  // (`shader/snapshotWgsl.ts`).
  const output = makeDagBuffer(own, readoutRow(listCap, regions, heldSlots))
  const readback = Array.from({ length: DAG_READBACK_SLOTS }, () =>
    own({
      size: readbackBytes,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    }),
  )
  return { listCap, outputBytes, readbackBytes, output, readback, heldSlots }
}

/** Where the open counts placements hold lie for the kernels — the first word in `out.pages`, the
 *  slots less one —: none without a table (`heldOpen.ts`). */
export const heldOpenAt = (resources: {
  listCap: number
  heldSlots: number
  swap: { regions: number }
}) => ({
  base: heldOpenWord(resources.listCap, resources.swap.regions) - HEAD,
  mask: Math.max(0, resources.heldSlots - 1),
})

/** The host's table of open counts written whole into `resources`' readout (`heldOpen.ts`): at
 *  open, and into a readout made again. */
function writeHeldOpen(resources: {
  device: GPUDevice
  output: GPUBuffer
  listCap: number
  heldSlots: number
  swap: { regions: number }
  packed: { heldOpen?: { words: Uint32Array<ArrayBuffer> } }
}) {
  const held = resources.packed.heldOpen
  if (!held || !resources.heldSlots) return
  const at = (heldOpenAt(resources).base + HEAD) * 4
  resources.device.queue.writeBuffer(resources.output, at, held.words)
}

/**
 * Gives the camera cut a list of `listCap` ranks and `regions` saved journals, between two frames
 * and with no readback in flight: a new readout and its slots, the bind groups that name it, and
 * the old ones destroyed. Made under an out-of-memory scope, within one binding: a device that
 * cannot grant them keeps the old readout whole and says `false`, so the next truncated readout
 * coarsens its cut (`coarsening.ts`) — or the views aside cut without a region — rather than end on an
 * error of the whole device. The kernels read the cap from the uniforms (`uniforms.ts`); the pool's list, in
 * `pageCones`, keeps its own (`layout.ts`).
 */
export async function growDagList(
  resources: DagResources,
  listCap: number,
  regions: number,
  disposed: () => boolean,
) {
  const bytes = readoutRow(listCap, regions, resources.heldSlots).size
  if (bytes > storageBufferCap(resources.device.limits)) return false
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
      () => createDagList(make, listCap, regions, resources.heldSlots),
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
  writeHeldOpen(resources)
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
