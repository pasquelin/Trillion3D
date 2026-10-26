import assert from 'node:assert/strict'
import { BASE_SLOTS } from '../../../packages/sdk-browser/src/visibility/bins/contract.ts'
import { VISIBLE_RECORD_WORDS } from '../../../packages/sdk-browser/src/geometry/dag/visible/layout.ts'
import {
  VIS_HW,
  VIS_SW,
  VISIBLE_HEADER_WORDS,
} from '../../../packages/sdk-browser/src/geometry/dag/visible/layout.fixture.ts'
import type { FakeDraw } from './fakeRenderPass.ts'
import { words } from './fakeBuffers.ts'
import { dagWorkLayout } from '../../../packages/sdk-browser/src/geometry/dag/shader/floorWgsl.ts'
import { ceilDiv } from '../../../packages/math/src/scalar/integers.ts'
import { BUFFER, TEXTURE } from './formats.ts'

/** A storage binding's offset alignment every WebGPU device grants (`minStorageBufferOffsetAlignment`). */
const STORAGE_OFFSET_ALIGN = 256

/**
 * Indirect commands of a hardware-raster image, with the invariants they all hold: at most one call
 * per slot, first instance at zero, page table bound at an aligned offset. Each test keeps only what
 * is its own — instances, bins, buffers.
 */
export function indirectDraws(draws: readonly FakeDraw[]) {
  const vis = draws.filter((draw) => draw.indirect)
  assert.ok(vis.length >= 1 && vis.length <= BASE_SLOTS)
  assert.ok(vis.every((draw) => draw.firstInstance === 0))
  assert.ok(vis.every((draw) => (draw.bindOffset ?? 0) % STORAGE_OFFSET_ALIGN === 0))
  return vis
}

/** The transparent passes' draws of an image — the blends', the transmissive layers' — on the blend vertex stage,
 *  the front pass's left out: it draws every run once more, for the transparents' front alone
 *  (`src/blend/frontPass.ts`). */
export const transparentDraws = (draws: readonly FakeDraw[]) =>
  draws.filter((draw) => draw.entryPoint === 'vs' && draw.fragment !== 'fsFront')

/** WebGPU's error classes, one each for the whole process: an error made before a later install is
 *  still an instance of the class the engine tests it against. */
class GPUOutOfMemoryError extends Error {}
class GPUPipelineError extends Error {}

export function installGpuGlobals() {
  Object.assign(globalThis, {
    GPUOutOfMemoryError,
    GPUPipelineError,
    GPUBufferUsage: BUFFER,
    GPUTextureUsage: TEXTURE,
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

/** The cut's mask of blended clusters in its `work` words, a bit a page (`blendMaskWgsl.ts`). */
export const drawMask = (workBytes: Uint8Array, pageCount: number) =>
  words(workBytes).subarray(dagWorkLayout(ceilDiv(Math.max(1, pageCount), 64)).drawMask)

/**
 * The clusters the cut lists visible in `buffer`, its list of visible clusters, read where the GPU
 * posts them: the records, the software raster's from the start, the hardware raster's from the
 * end (`geometry/dag/visible/layout.ts`). Each is its index in the list — the index the decode
 * writes its record at —, its page and its placement.
 */
export function visibleClusters(buffer: { data: Uint8Array }) {
  const list = words(buffer.data),
    cap = Math.floor((list.length - VISIBLE_HEADER_WORDS) / VISIBLE_RECORD_WORDS)
  const at = (index: number) => {
    const record = VISIBLE_HEADER_WORDS + VISIBLE_RECORD_WORDS * index
    return { index, page: list[record], placement: list[record + 1] }
  }
  const clusters = []
  for (let k = 0; k < Math.min(list[VIS_SW], cap); k++) clusters.push(at(k))
  for (let k = 0; k < Math.min(list[VIS_HW], cap); k++) clusters.push(at(cap - 1 - k))
  return clusters
}

/**
 * Pages the CURRENT IMAGE's cut draws, read where the GPU posts them: the list of visible clusters
 * of the last cut the device made. That is the selection the image draws, whichever raster consumes
 * it — hardware by its indirect commands, or the software raster by its binned lists — and not a
 * past image's sample.
 */
export function drawnPageIds(buffers: ReadonlyArray<{ label?: string; data: Uint8Array }>) {
  const buffer = buffers.findLast((entry) => entry.label === 'Trillion3D DAG visible clusters')
  if (!buffer) throw new Error('Trillion3D DAG visible clusters buffer absent')
  return visibleClusters(buffer)
    .map(({ page }) => page)
    .sort((a, b) => a - b)
}
