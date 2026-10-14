/**
 * THE LISTS OF A CHUNKED RASTER OVER CASTER ROWS (`renderPass.ts`, the transmission's bin): their
 * sizes for a chunk, the rows a chunk takes within the room the device ledger admits, and their
 * growth — the engine's one rule (`sizedBuffer`), which the room's estimate follows.
 */
import { ceilDiv } from '../../../math/src/scalar/integers.ts'
import { grownLength } from '../../../math/src/sequence/resized.ts'
import { ledgerRoom } from '../gpu/core/deviceLedger.ts'
import { sizedBuffer } from '../gpu/core/sizedBuffer.ts'
import { madeTextureBytes } from '../gpu/core/textureBytes.ts'
import type { UniformSlots } from '../residency/pools.ts'
import {
  VSM_RENDER_CANDIDATE_BYTES,
  VSM_RENDER_CMD_BYTES,
  VSM_RENDER_PAIR_BYTES,
} from './constants.ts'
import { VSM_RENDER_ARGS_STRIDE_WORDS, VSM_RENDER_COUNTS_HEAD } from './renderCullWgsl.ts'
import type { VsmChunk } from './rowPageBound.ts'

/** The lists a chunked raster holds, by name. */
export type VsmListName = 'params' | 'views' | 'candidates' | 'counts' | 'cmds' | 'pairs' | 'args'

/** Bytes a list holds at least: a binding is never empty, whatever a chunk asks. */
const LIST_FLOOR = 256

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

/** The lists a chunk of `rows` rows takes, by buffer, when `chunked` rows are drawn in chunks
 *  over `candidates` candidate rows, `viewWords` words of views, a chunk holding `holds`, its
 *  parameter slots `slots`. */
export function vsmChunkListSizes(
  rows: number,
  chunked: number,
  candidates: number,
  viewWords: number,
  holds: Omit<VsmChunk, 'rows'>,
  slots: UniformSlots,
) {
  const chunks = ceilDiv(chunked, rows)
  return {
    params: chunks * slots.stride,
    views: viewWords * 4,
    candidates: candidates * VSM_RENDER_CANDIDATE_BYTES,
    counts: (VSM_RENDER_COUNTS_HEAD + chunks * 4) * 4,
    cmds: holds.cmds(rows) * VSM_RENDER_CMD_BYTES,
    pairs: holds.pairs(rows) * VSM_RENDER_PAIR_BYTES,
    args: chunks * VSM_RENDER_ARGS_STRIDE_WORDS * 4,
  }
}

/**
 * The most rows a chunk takes, `rows` then its halves down to one, whose lists (`sizes` of a
 * chunk of that many rows) grow within the room the device ledger still admits, and those lists;
 * 0 rows when not even one row's do. A chunk of fewer rows draws the same pages — the raster's
 * depth is an atomic max, whatever the order — in more passes, and asks no allocation the
 * budget refuses. Lists that need not grow ask nothing of the ledger.
 */
export function vsmChunkRowsWithin<S extends Record<string, number>>(
  device: GPUDevice,
  buffers: Partial<Record<string, GPUBuffer>>,
  rows: number,
  sizes: (rows: number) => S,
): { rows: number; size?: S; limited: boolean } {
  const whole = sizes(rows)
  if (growthBytes(buffers, whole) === 0) return { rows, size: whole, limited: false }
  const room = ledgerRoom(device)
  for (let r = rows; ; r = ceilDiv(r, 2)) {
    const size = r === rows ? whole : sizes(r)
    if (growthBytes(buffers, size) <= room) return { rows: r, size, limited: r < rows }
    if (r === 1) return { rows: 0, limited: true }
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

/** The seven lists of a chunked raster under `label`, grown to `size` (`vsmChunkListSizes`) by the
 *  engine's one rule (`sizedBuffer`): the buffers its parameters, its views, its counters and its
 *  arguments are written or cleared in. */
export function vsmEnsureLists(
  ctx: { device: GPUDevice; buffers: Partial<Record<VsmListName, GPUBuffer>> },
  label: string,
  size: ReturnType<typeof vsmChunkListSizes>,
) {
  const { device, buffers } = ctx
  const ensure = (name: VsmListName, usage: GPUBufferUsageFlags) =>
    (buffers[name] = sizedBuffer(
      device,
      buffers[name],
      Math.max(size[name], LIST_FLOOR),
      usage,
      `${label}.${name}`,
    ))
  const storage = vsmRenderStorage()
  const params = ensure('params', GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST)
  const views = ensure('views', storage)
  ensure('candidates', storage)
  const counts = ensure('counts', storage)
  ensure('cmds', storage)
  ensure('pairs', storage)
  const args = ensure('args', storage | GPUBufferUsage.INDIRECT)
  return { params, views, counts, args }
}
