/**
 * THE LISTS OF A CHUNKED RASTER OVER CASTER ROWS (`renderPass.ts`, the transmission's bin): the
 * rows a chunk takes within the room the device ledger admits, at the sizes `chunkSizing.ts` gives,
 * and their growth — the engine's one rule (`sizedBuffer`), which the room's estimate follows.
 */
import { ceilDiv } from '../../../math/src/scalar/integers.ts'
import { grownLength } from '../../../math/src/sequence/resized.ts'
import { ledgerRoom } from '../gpu/core/deviceLedger.ts'
import { sizedBuffer } from '../gpu/core/sizedBuffer.ts'
import { madeTextureBytes } from '../gpu/core/textureBytes.ts'
import type { VsmListName, VsmListSizes, VsmWithin } from './chunkSizing.ts'

/** Bytes a list holds at least: a binding is never empty, whatever a chunk asks. */
const LIST_FLOOR = 256
/** The lists the kernels fill that are storage alone, in the order they are made. */
const STORAGE_LISTS: readonly VsmListName[] = ['views', 'candidates', 'counts', 'cmds', 'pairs']

/** Usage of the lists the kernels fill. */
export const vsmRenderStorage = () => GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST

/** Frees what a draw context holds on the device: its lists and its dummy target. */
export function vsmReleaseContext(ctx: {
  buffers: Partial<Record<string, GPUBuffer>>
  targetTexture?: GPUTexture
}) {
  for (const buffer of Object.values(ctx.buffers)) buffer?.destroy()
  ctx.targetTexture?.destroy()
}

/** Bytes a draw context holds on the device: its lists and its dummy target, if any. */
export function vsmContextBytes(ctx: {
  buffers: Partial<Record<string, GPUBuffer>>
  targetTexture?: GPUTexture
}) {
  let bytes = ctx.targetTexture ? madeTextureBytes(ctx.targetTexture) : 0
  for (const buffer of Object.values(ctx.buffers)) bytes += buffer?.size ?? 0
  return bytes
}

/** Bytes the device is asked for when `buffers` grow to `sizes` (`vsmEnsureLists`, `sizedBuffer`):
 *  each one short of its size made anew, whole, while the one it held still lives — retired after
 *  the frame's submit (`grownByCopy`). */
function growthBytes(buffers: Partial<Record<string, GPUBuffer>>, sizes: Record<string, number>) {
  let total = 0
  for (const name in sizes) {
    const held = buffers[name]?.size ?? 0,
      size = Math.max(sizes[name], LIST_FLOOR)
    if (held < size) total += grownLength(held, size)
  }
  return total
}

/**
 * The most rows a chunk takes, `rows` then its halves down to one, whose lists (`sizes` of a
 * chunk of that many rows) grow within the room the device ledger still admits, and those lists;
 * 0 rows when not even one row's do; written into `within`. A chunk of fewer rows draws the same
 * pages — the raster's depth is an atomic max, whatever the order — in more passes, and asks no
 * allocation the budget refuses. Lists that need not grow ask nothing of the ledger.
 */
export function vsmChunkRowsWithin<S extends Record<string, number>>(
  device: GPUDevice,
  buffers: Partial<Record<string, GPUBuffer>>,
  rows: number,
  sizes: (rows: number) => S,
  within: VsmWithin<S>,
) {
  const whole = sizes(rows)
  within.rows = rows
  within.size = whole
  within.limited = false
  if (growthBytes(buffers, whole) === 0) return within
  const room = ledgerRoom(device)
  for (let r = rows; ; r = ceilDiv(r, 2)) {
    // `sizes` may rewrite one record: the first try reads the whole chunk's, still held.
    const size = r === rows ? whole : sizes(r)
    within.rows = r
    within.size = size
    within.limited = r < rows
    if (growthBytes(buffers, size) <= room) return within
    if (r === 1) {
      within.rows = 0
      within.size = undefined
      within.limited = true
      return within
    }
  }
}

/** The fewest bytes lists of `sizes` take, over the chunk sizes `vsmChunkRowsWithin` tries from
 *  `rows`: fewer rows take smaller lists of pairs, more chunks larger lists of parameters. */
export function vsmDrawFloorBytes(rows: number, sizes: (rows: number) => Record<string, number>) {
  let least = Infinity
  for (let r = rows; ; r = ceilDiv(r, 2)) {
    least = Math.min(least, growthBytes({}, sizes(r)))
    if (r === 1) return least
  }
}

/** List `name` of `ctx` under `label`, grown to `size` by the engine's one rule (`sizedBuffer`). */
function ensureList(
  ctx: { device: GPUDevice; buffers: Partial<Record<VsmListName, GPUBuffer>> },
  label: string,
  size: VsmListSizes,
  name: VsmListName,
  usage: GPUBufferUsageFlags,
) {
  const held = ctx.buffers[name],
    bytes = Math.max(size[name], LIST_FLOOR)
  ctx.buffers[name] = sizedBuffer(ctx.device, held, bytes, usage, `${label}.${name}`)
}

/** The seven lists of a chunked raster under `label`, grown to `size` (`vsmChunkListSizes`): the
 *  context's own buffers, every one made, returned — its parameters, its views, its counters and
 *  its arguments are written or cleared in them. A frame allocates nothing. */
export function vsmEnsureLists(
  ctx: { device: GPUDevice; buffers: Partial<Record<VsmListName, GPUBuffer>> },
  label: string,
  size: VsmListSizes,
) {
  const storage = vsmRenderStorage()
  ensureList(ctx, label, size, 'params', GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST)
  for (const name of STORAGE_LISTS) ensureList(ctx, label, size, name, storage)
  ensureList(ctx, label, size, 'args', storage | GPUBufferUsage.INDIRECT)
  return ctx.buffers as Record<VsmListName, GPUBuffer>
}
