import { OUT_COUNT, selectionListCap, stagedOutputBytes } from '../layout.ts'
import { listWords, SELECTION_HEADER_WORDS } from '../readoutWords.ts'
import { heldOpenSlots } from '../heldOpen.ts'
import { makeDagBuffer, readoutRow } from '../bufferTable.ts'
import { storageBufferCap } from '../../../session/memory/pools.ts'
import { type Limits, deviceListCap } from '../deviceListCap.ts'

/** The readout's cap for a cut asking `size` ranks (`requestSize.ts`, `selectionListCap`,
 *  `../layout.ts`), within the device beside the `heldSlots` slots of open counts its readout holds
 *  (`../heldOpen.ts`): a cut that lists more is read by its head
 *  (`../../cut/adoption/adoption.ts`), its mask drawn whole. */
export const listCapFor = (limits: Limits, pageCount: number, size: number, heldSlots = 0) =>
  Math.min(selectionListCap(pageCount, size), deviceListCap(limits, heldSlots))

/**
 * The slots of the open counts a cut's placements hold (`../heldOpen.ts`), for the `rows` clusters
 * the cut's visible list holds room for: within a quarter of what one binding leaves past the lists
 * at their first cap, the `least` ranks the settings allow (`requestSize.ts`), so the lists always
 * come first; a table that small leaves more counts at their node's, never a list short.
 */
export function cutHeldSlots(limits: Limits, pageCount: number, rows: number, least: number) {
  const lists = stagedOutputBytes(listCapFor(limits, pageCount, least))
  return heldOpenSlots(rows, (storageBufferCap(limits) - lists) / 4)
}

/** Ranks the cut asked of its readout, kept or not: the camera requests' counter, and the drawn
 *  list's behind them, both counted past the cap (`../shader/snapshotWgsl.ts`, `../shader/finishWgsl.ts`). */
export function listDemand(bytes: ArrayBuffer, drawnWordOffset: number) {
  const ints = new Uint32Array(bytes, 0, drawnWordOffset + 1)
  return Math.max(ints[OUT_COUNT], drawnWordOffset ? ints[drawnWordOffset] : 0)
}

/** The readout of a cut whose list holds `listCap` ranks, the `heldSlots` slots of the open counts
 *  placements hold behind it (`../heldOpen.ts`): the buffer the kernels write, and the bytes a frame
 *  copies of it into its readback ring (`resources.readbacks`, sized at each take), made by `own`
 *  (`../resources.ts`). */
export function createDagList(
  own: (descriptor: GPUBufferDescriptor) => GPUBuffer,
  listCap: number,
  heldSlots = 0,
) {
  const outputBytes = listWords(listCap) * 4,
    // The requests, the drawn list and the requests' priorities and page counts
    // (`../readoutWords.ts`).
    readbackBytes = stagedOutputBytes(listCap)
  const output = makeDagBuffer(own, readoutRow(listCap, heldSlots))
  return { listCap, outputBytes, readbackBytes, output, heldSlots }
}

/** Where the open counts placements hold lie for the kernels — the first word in `out.pages`, the
 *  slots less one —: none without a table (`../heldOpen.ts`). */
export const heldOpenAt = (resources: { listCap: number; heldSlots: number }) => ({
  base: stagedOutputBytes(resources.listCap) / 4 - SELECTION_HEADER_WORDS,
  mask: Math.max(0, resources.heldSlots - 1),
})
