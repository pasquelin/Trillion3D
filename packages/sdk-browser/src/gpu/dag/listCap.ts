import {
  OUT_COUNT,
  savedJournalWord,
  residentReadbackBytes,
  selectionListCap,
  stagedOutputBytes,
} from './layout.ts'
import { SELECTION_HEADER_WORDS } from './readoutWords.ts'
import { heldOpenSlots } from './heldOpen.ts'
import { makeDagBuffer, readoutRow } from './bufferTable.ts'
import type { CameraFrames } from './cameraFrames.ts'
import { storageBufferCap } from '../../residency/pools.ts'
import { type Limits, deviceListCap } from './deviceListCap.ts'
import { keptRankRow } from './keptRanks.ts'

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
 *  (`heldOpen.ts`): the buffer the kernels write, the bytes a frame copies of it into its readback
 *  ring (`resources.readbacks`, sized at each take), and each kept list's table of ranks
 *  (`keptRanks.ts`), which its kernels bind as `work`, each made by `own` (`resources.ts`). */
export function createDagList(
  own: (descriptor: GPUBufferDescriptor) => GPUBuffer,
  listCap: number,
  regions = 0,
  heldSlots = 0,
) {
  const outputBytes = (SELECTION_HEADER_WORDS + listCap) * 4,
    // The requests, the drawn list and one burst of the eviction queue (`EVICTION_BURST`).
    readbackBytes = residentReadbackBytes(listCap)
  // Behind the eviction queue, the requests wait for their sort, outside what the frame copies
  // (`shader/snapshotWgsl.ts`).
  const output = makeDagBuffer(own, readoutRow(listCap, regions, heldSlots))
  const ranks = [0, 1].map((l) => makeDagBuffer(own, keptRankRow(l, listCap)))
  return { listCap, outputBytes, readbackBytes, output, heldSlots, ranks }
}

/** Where the open counts placements hold lie for the kernels — the first word in `out.pages`, the
 *  slots less one —: none without a table (`heldOpen.ts`). */
export const heldOpenAt = (resources: {
  listCap: number
  heldSlots: number
  swap: { regions: number }
}) => ({
  base: savedJournalWord(resources.listCap, resources.swap.regions) - SELECTION_HEADER_WORDS,
  mask: Math.max(0, resources.heldSlots - 1),
})

/** The cut's group of each kept list, its ranks where the cut binds `work`: what its difference
 *  kernels bind (`shader/differenceWgsl.ts`), made again with the cut's group when `out` is. */
export function rankGroups(resources: {
  layout: GPUBindGroupLayout
  frames: Pick<CameraFrames, 'bindGroup'>
  group: Parameters<CameraFrames['bindGroup']>[1]
  ranks: GPUBuffer[]
}) {
  const { layout, frames, group } = resources
  return resources.ranks.map((work) => frames.bindGroup(layout, { ...group, work }))
}
