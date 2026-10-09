import assert from 'node:assert/strict'
import { SELECTION_HEADER_WORDS } from '../../../packages/sdk-browser/src/gpu/dag/layout.ts'
import { BASE_SLOTS } from '../../../packages/sdk-browser/src/gpu/draw/draw.ts'
import type { MockDraw } from './mockEncoder.ts'
import { words } from './mockBuffers.ts'
import { dagWorkLayout } from '../../../packages/sdk-browser/src/gpu/dag/shader/floorWgsl.ts'
import { ceilDiv } from '../../../packages/math/src/scalar/integers.ts'

/** A storage binding's offset alignment every WebGPU device grants (`minStorageBufferOffsetAlignment`). */
const STORAGE_OFFSET_ALIGN = 256

/**
 * Indirect commands of a hardware-raster image, with the invariants they all hold: at most one call
 * per slot, first instance at zero, page table bound at an aligned offset. Each test keeps only what
 * is its own — instances, bins, buffers.
 */
export function indirectDraws(draws: readonly MockDraw[]) {
  // The material classes draw their tiles indirectly too (`materialTiles.ts`): not the raster's.
  const vis = draws.filter((draw) => draw.indirect && draw.entryPoint !== 'shade_tile_vs')
  assert.ok(vis.length >= 1 && vis.length <= BASE_SLOTS)
  assert.ok(vis.every((draw) => draw.firstInstance === 0))
  assert.ok(vis.every((draw) => (draw.bindOffset ?? 0) % STORAGE_OFFSET_ALIGN === 0))
  return vis
}

export function installGpuGlobals() {
  Object.assign(globalThis, {
    GPUBufferUsage: {
      MAP_READ: 1,
      MAP_WRITE: 2,
      COPY_SRC: 4,
      COPY_DST: 8,
      INDEX: 16,
      VERTEX: 32,
      UNIFORM: 64,
      STORAGE: 128,
      INDIRECT: 256,
      QUERY_RESOLVE: 512,
    },
    GPUTextureUsage: {
      COPY_SRC: 1,
      COPY_DST: 2,
      TEXTURE_BINDING: 4,
      STORAGE_BINDING: 8,
      RENDER_ATTACHMENT: 16,
    },
    GPUShaderStage: { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 },
    GPUMapMode: { READ: 1, WRITE: 2 },
  })
}

/** `writeBuffer`'s window: `dataOffset` and `size` count elements of `data`, bytes for an ArrayBuffer. */
export function bytesOf(data: GPUAllowSharedBufferSource, dataOffset = 0, size?: number) {
  if (!ArrayBuffer.isView(data))
    return new Uint8Array(data, dataOffset, size ?? data.byteLength - dataOffset)
  const view = data,
    element = (view as { BYTES_PER_ELEMENT?: number }).BYTES_PER_ELEMENT ?? 1
  const start = view.byteOffset + dataOffset * element
  return new Uint8Array(
    view.buffer,
    start,
    size === undefined ? view.byteLength - dataOffset * element : size * element,
  )
}

/**
 * Replays the compaction the GPU does of draw flags: the count, then the ranks of drawable pages in
 * increasing order, like the kernels of `../../../packages/sdk-browser/src/gpu/dag/shader/compactWgsl.ts`. It extends the sample, behind the
 * wanted pages, in the same buffer.
 */
export function compactDrawnPages(workBytes: Uint8Array, outBytes: Uint8Array, pageCount: number) {
  const marks = drawMask(workBytes, pageCount),
    out = words(outBytes)
  const head = SELECTION_HEADER_WORDS,
    base = head + pageCount
  let found = 0
  for (let id = 0; id < pageCount; id++) if (drawn(marks, id)) out[base + head + found++] = id
  out[base] = found
}

/** The cut's draw mask in its `work` words, a bit a page (`compactWgsl.ts`), and page `id`'s bit. */
export const drawMask = (workBytes: Uint8Array, pageCount: number) =>
  words(workBytes).subarray(dagWorkLayout(ceilDiv(Math.max(1, pageCount), 64)).drawMask)
const drawn = (mask: Uint32Array, id: number) => (mask[id >>> 5] & (1 << (id & 31))) !== 0
/** Page `id`'s bit of the draw mask at word `offset` of `words` (`compactWgsl.ts`). */
export const maskBit = (words: Uint32Array, offset: number, id: number) =>
  drawn(words.subarray(offset), id)

/**
 * Pages the CURRENT IMAGE's mask names, read where the GPU posts them: the draw mask's bits in the
 * cut's `work` (`drawMask`). That is the selection the image draws, whichever raster consumes it — hardware by
 * its indirect commands, or compute in place under the `raster-compute` variant — and not a past
 * image's sample.
 */
export function drawnPageIds(
  buffers: ReadonlyArray<{ label?: string; data: Uint8Array }>,
  packed: { pageCount: number },
) {
  const { pageCount } = packed
  const buffer = buffers.find((entry) => entry.label === 'Trillion3D DAG work')
  if (!buffer) throw new Error('Trillion3D DAG work buffer absent')
  const marks = drawMask(buffer.data, pageCount)
  const ids: number[] = []
  for (let id = 0; id < pageCount; id++) if (drawn(marks, id)) ids.push(id)
  return ids
}
