import { validationScope } from '../core/errorScope.ts'
import { pendingBuffers } from '../core/tableGrowth.ts'
import {
  DAG_READBACK_SLOTS,
  KEPT_HEADER_WORDS,
  OUT_COUNT,
  SELECTION_HEADER_WORDS as HEAD,
  savedJournalWord,
  keptSnapshotWord,
  residentReadbackBytes,
  selectionListCap,
  stagedOutputBytes,
} from './layout.ts'
import { heldOpenSlots } from './heldOpen.ts'
import { makeDagBuffer, readoutRow } from './bufferTable.ts'
import { cutBytes, madeAsked } from './cutBuffers.ts'
import type { createDagResources } from './resources.ts'
import type { CameraFrames } from './frameRanges.ts'
import { newRegions } from './swap.ts'
import { storageBufferCap } from '../../residency/pools.ts'
import { type Limits, deviceListCap } from './deviceListCap.ts'
import { keptRankRow } from './keptRanks.ts'
import { HELD_BY_WORD } from './worlds.ts'
import { viewWord } from './viewLayout.ts'
import { dispatchRows, groupWidth } from '../dispatch/grid.ts'
import { SELECTION_WORKGROUP as WORKGROUP } from '../core/selection.ts'
import { workgroupCount } from '../../../../math/src/scalar/integers.ts'
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
 *  (`heldOpen.ts`): the buffer the kernels write, the readback slots the frame copies it into, and
 *  each kept list's table of ranks (`keptRanks.ts`), which its kernels bind as `work`, each made by
 *  `own` (`resources.ts`). */
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
      label: 'Trillion3D DAG readback slot',
      size: readbackBytes,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    }),
  )
  const ranks = [0, 1].map((l) => makeDagBuffer(own, keptRankRow(l, listCap)))
  return { listCap, outputBytes, readbackBytes, output, readback, heldSlots, ranks }
}

/** Where the open counts placements hold lie for the kernels — the first word in `out.pages`, the
 *  slots less one —: none without a table (`heldOpen.ts`). */
export const heldOpenAt = (resources: {
  listCap: number
  heldSlots: number
  swap: { regions: number }
}) => ({
  base: savedJournalWord(resources.listCap, resources.swap.regions) - HEAD,
  mask: Math.max(0, resources.heldSlots - 1),
})

/** The host's table of open counts written whole into `resources`' readout (`heldOpen.ts`): at
 *  open, and into a readout made again — made again itself first when the readout holds more slots
 *  (`queueGrowth.ts`), each placement whose count moved told in its frame words. A table laid out
 *  for other slots is not this cut's: its residency upload makes its own (`residencyUpload.ts`). */
function writeHeldOpen(resources: DagResources, grown: boolean) {
  const held = resources.packed.heldOpen
  if (!held || !resources.heldSlots) return
  if (grown && held.slots < resources.heldSlots) {
    held.resize(resources.heldSlots)
    for (const w of held.takePlacements())
      resources.frames.writeWord(w, HELD_BY_WORD, held.heldBy(w))
    resources.frames.flushWords()
  }
  if (held.slots !== resources.heldSlots) return
  const at = (heldOpenAt(resources).base + HEAD) * 4
  resources.device.queue.writeBuffer(resources.output, at, held.words)
}

/**
 * Gives the camera cut a list of `listCap` ranks, `regions` saved journals and `heldSlots` slots of
 * open counts, between two frames and with no readback in flight: a new readout and its slots, the
 * bind groups that name it, and the old ones destroyed. Made under an out-of-memory scope, within one binding: a device that
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
  heldSlots = resources.heldSlots,
) {
  const bytes = readoutRow(listCap, regions, heldSlots).size
  if (bytes > storageBufferCap(resources.device.limits)) return false
  const made: GPUBuffer[] = []
  // What the readout replaces leaves the share: the new one is made within what remains.
  const replaced = [resources.output, ...resources.readback, ...resources.ranks]
  const make = madeWithin(resources, replaced, made)
  let list: ReturnType<typeof createDagList> | undefined
  try {
    const { value, error } = await validationScope(
      resources.device,
      () => createDagList(make, listCap, regions, heldSlots),
      'out-of-memory',
    )
    if (!error) list = value
  } catch {
    /* A creation the device throws on is a refusal too. */
  }
  const old = [resources.output, ...resources.readback, ...resources.ranks]
  const growth = cutGrowth(resources, made, old, () => {
    const from = { output: resources.output, listCap: resources.listCap },
      grown = heldSlots > resources.heldSlots
    Object.assign(resources, list)
    resources.group.out = list!.output
    resources.ranges = resources.frames.bindGroups(resources.layout, resources.group)
    resources.rankGroups = rankGroups(resources)
    // The saved journals and the lists were the old readout's (`swap.ts`).
    newRegions(resources.swap, regions)
    writeHeldOpen(resources, grown)
    carryKeptSnapshot(resources, from)
  })
  // Refused, or `dispose` came meanwhile: nothing made outlives this call.
  if (!list || disposed()) {
    growth.destroy()
    return false
  }
  growth.commit()
  return true
}

/**
 * The growth of the cut's buffers (`../core/tableGrowth.ts`): `made` replaces `replaced`, which
 * `adopt` puts in place; the cut's buffer list follows, and `replaced` is freed at commit.
 */
export const cutGrowth = (
  resources: DagResources,
  made: readonly GPUBuffer[],
  replaced: readonly GPUBuffer[],
  adopt: () => void,
) =>
  pendingBuffers(made, () => {
    adopt()
    resources.buffers.push(...made)
    for (const buffer of replaced) resources.buffers.splice(resources.buffers.indexOf(buffer), 1)
    return replaced
  })

/**
 * The kept snapshot carried into the grown readout `to`, lengths and both lists, each at the place
 * the new cap gives it (`keptSnapshotWord`), then each list ranked in its new table
 * (`shader/differenceWgsl.ts`, `dagCutRekeep`) — the kernels read the new cap, written first —:
 * the next copy's difference is taken against it as if the list had not grown, and the readbacks
 * since keep naming their pages by its ranks (`differenceChain.ts`).
 */
function carryKeptSnapshot(to: DagResources, from: { output: GPUBuffer; listCap: number }) {
  const { device } = to,
    encoder = device.createCommandEncoder(),
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
  device.queue.writeBuffer(to.uniforms, viewWord('listCap') * 4, Uint32Array.of(to.listCap))
  const pass = encoder.beginComputePass({ label: 'Trillion3D DAG selection' })
  to.rekeepPipelines.forEach((pipeline, l) => {
    pass.setBindGroup(0, to.rankGroups[l])
    pass.setPipeline(pipeline)
    dispatchRows(pass, workgroupCount(from.listCap, WORKGROUP), 1, groupWidth(device.limits))
  })
  pass.end()
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

/**
 * A maker of the buffers that replace `replaced`, each noted in `made`: one that would take the cut
 * past its share — what it holds, less what it replaces, with what is made — is never made, and the
 * growth is refused by name (`pastShare`): the view coarsens instead (`coarsening.ts`).
 */
export function madeWithin(
  resources: DagResources,
  replaced: readonly GPUBuffer[],
  made: GPUBuffer[],
) {
  const kept = cutBytes(resources) - replaced.reduce((sum, buffer) => sum + buffer.size, 0)
  return (descriptor: GPUBufferDescriptor) => {
    const held = kept + made.reduce((sum, buffer) => sum + buffer.size, 0)
    const buffer = madeAsked(resources.device, resources.admit, held, resources.share, descriptor)
    made.push(buffer)
    return buffer
  }
}
