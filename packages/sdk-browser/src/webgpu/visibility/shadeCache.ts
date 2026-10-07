import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { dispatchGrid } from '../../gpu/dag/shader/gridWgsl.ts'
import { CACHED, cachePasses } from './shadeCachePasses.ts'
import { heldSwitch } from '../../host/heldSwitch.ts'
import { createWebgpuBindIdentity } from '../core/bindIdentity.ts'
import { vsmWriteChanged } from '../../vsm/writeChanged.ts'
import type { OpenPass } from '../../gpu/core/lazyComputePass.ts'
import {
  MARK_TILE,
  ROW_MARK_WORDS,
  ROW_RECORD_WORDS,
  ROW_TRIANGLES,
  SHADE_CACHE_CAPACITY_WORD,
  SHADE_CACHE_HEADER_WORDS,
  SHADE_CACHE_ROWS_WORD,
  SHADE_ROWS_LANES,
  TRIANGLE_WORDS,
} from '../../visibility/shader/shadeCacheWgsl.ts'

/** The material cache's A/B in the host URL, temporary, each read once at preparation; the same
 *  image every way. `trillion3dShadeNoCache=1`: no pass encoded, every pixel composes and decodes
 *  its own (`SHADE_CACHE` left out). */
const shadeNoCacheAsked = heldSwitch('trillion3dShadeNoCache')

/** What the frame's passes read beside the cache: the visibility buffer, the page table, the
 *  geometry the pixels decode and the resolve's uniform. */
export type ShadeCacheInputs = {
  vis: GPUTextureView
  pages: GPUBuffer
  indices: GPUBuffer
  positions: GPUBuffer
  uvs: GPUBuffer
  normals: GPUTextureView
  uniform: GPUBuffer
}

/**
 * The resolve's frame cache (`../../visibility/shader/shadeCacheWgsl.ts`): its buffer, laid each
 * image for the page table's rows, and the passes that fill it before the class draws.
 * `constants` are the resolve pipelines' overrides — the passes run, the pixel reads what they
 * store; passes the device refused leave them out, and each pixel computes its own.
 * The buffer exists either way: the resolve's group binds it. The triangles pass's dispatch is the
 * rows pass's (`work`): x and y cleared each image, raised by the rows whose triangles fit.
 *
 * The triangles' capacity is derived, never tuned: no more than the rows hold — each row's
 * triangles at most the widest page's — and no more words than the visibility buffer it is read
 * from holds texels, one word each. A row whose triangles do not fit is decoded by its pixels.
 */
export async function createShadeCache(device: GPUDevice) {
  const passes = shadeNoCacheAsked() ? undefined : await cachePasses(device)
  const c: Cache = {
    ...{ device, passes },
    // The header words the host writes, the rows and the capacity; the cursor and the end of the
    // fitting slots, which the passes raise, the pass's first dispatch zeroes (`shade_clear`).
    header: new Uint32Array(SHADE_CACHE_HEADER_WORDS),
    clearGrid: [0, 0],
    rowsGrid: [0, 0],
    buffer: cacheBuffer(device, SHADE_CACHE_HEADER_WORDS),
    words: SHADE_CACHE_HEADER_WORDS,
    ...{ rowsGroup: undefined, trisGroup: undefined, width: 0, height: 0 },
    bound: createWebgpuBindIdentity(),
  }
  const constants: Record<string, number> = { ...(passes && CACHED) }
  return {
    constants,
    get buffer() {
      return c.buffer
    },
    /**
     * Lays the sections for `tableRows` rows of at most `maxCorners` corners and a `pixelWidth` ×
     * `pixelHeight` visibility buffer, the buffer grown to hold them, and writes the header words
     * the passes and the resolve read — the rows, the capacity — when they changed.
     */
    layFor: (tableRows: number, maxCorners: number, pixelWidth: number, pixelHeight: number) =>
      layFor(c, tableRows, maxCorners, pixelWidth, pixelHeight),
    /** The image's passes, as dispatches of the frame's compute pass, before the class draws
     *  read what they store: the marks cleared, then marks, rows and triangles — the fitting
     *  slots' alone, at the size the rows pass wrote. None when no row is laid: rows are zero
     *  on a device that refused the passes. */
    encode: (open: OpenPass, inputs: ShadeCacheInputs) => encodeShade(c, open, inputs),
    dispose() {
      c.buffer.destroy()
      passes?.work.destroy()
    },
  }
}

type Cache = {
  device: GPUDevice
  passes: Awaited<ReturnType<typeof cachePasses>>
  header: Uint32Array<ArrayBuffer>
  /** The image's grids, laid with its rows: the clear's, one lane per mark word, and the rows'. */
  clearGrid: [number, number]
  rowsGrid: [number, number]
  buffer: GPUBuffer
  words: number
  rowsGroup: GPUBindGroup | undefined
  trisGroup: GPUBindGroup | undefined
  width: number
  height: number
  bound: ReturnType<typeof createWebgpuBindIdentity>
}

const cacheBuffer = (device: GPUDevice, words: number) =>
  device.createBuffer({
    label: 'Trillion3D material cache',
    size: words * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })

function layFor(
  c: Cache,
  tableRows: number,
  maxCorners: number,
  pixelWidth: number,
  pixelHeight: number,
) {
  const { passes, header } = c
  const rows = passes ? tableRows : 0,
    capacity = Math.min(
      rows * Math.min(ceilDiv(maxCorners, 3), ROW_TRIANGLES),
      Math.floor((pixelWidth * pixelHeight) / TRIANGLE_WORDS),
    )
  const needed =
    SHADE_CACHE_HEADER_WORDS +
    rows * (ROW_RECORD_WORDS + ROW_MARK_WORDS) +
    capacity * TRIANGLE_WORDS
  if (needed > c.words) {
    c.buffer.destroy()
    c.buffer = cacheBuffer(c.device, (c.words = needed))
  }
  c.width = pixelWidth
  c.height = pixelHeight
  if (rows !== header[SHADE_CACHE_ROWS_WORD] && passes) {
    c.clearGrid = dispatchGrid(ceilDiv(rows * ROW_MARK_WORDS, SHADE_ROWS_LANES), passes.span)
    c.rowsGrid = dispatchGrid(ceilDiv(rows, SHADE_ROWS_LANES), passes.span)
  }
  header[SHADE_CACHE_ROWS_WORD] = rows
  header[SHADE_CACHE_CAPACITY_WORD] = capacity
  // The words that changed; a new buffer is held as its zeros (`vsmWriteChanged`).
  vsmWriteChanged(c.device, c.buffer, header, SHADE_CACHE_ROWS_WORD, SHADE_CACHE_CAPACITY_WORD + 1)
}

function encodeShade(c: Cache, open: OpenPass, inputs: ShadeCacheInputs) {
  const { passes } = c
  if (!passes || !c.header[SHADE_CACHE_ROWS_WORD]) return
  const n = c.bound.next
  n[0] = c.buffer
  n[1] = inputs.pages
  n[2] = inputs.vis
  n[3] = inputs.indices
  n[4] = inputs.positions
  n[5] = inputs.uvs
  n[6] = inputs.uniform
  n[7] = inputs.normals
  if (c.bound.moved() || !c.rowsGroup) bindShade(c, passes, inputs)
  const pass = open.pass
  // The marks and the triangles' dispatch start from zero: the pass's first dispatch.
  pass.setPipeline(passes.shade_clear)
  pass.setBindGroup(0, c.rowsGroup!)
  pass.dispatchWorkgroups(c.clearGrid[0], c.clearGrid[1])
  pass.setPipeline(passes.shade_marks)
  pass.dispatchWorkgroups(ceilDiv(c.width, MARK_TILE), ceilDiv(c.height, MARK_TILE))
  pass.setPipeline(passes.shade_rows)
  pass.dispatchWorkgroups(c.rowsGrid[0], c.rowsGrid[1])
  pass.setPipeline(passes.shade_tris)
  pass.setBindGroup(0, c.trisGroup!)
  pass.dispatchWorkgroupsIndirect(passes.work, 0)
}

function bindShade(c: Cache, passes: NonNullable<Cache['passes']>, inputs: ShadeCacheInputs) {
  const { device, buffer } = c
  const buffers = [inputs.pages, buffer, inputs.indices, inputs.positions, inputs.uvs]
  c.rowsGroup = device.createBindGroup({
    layout: passes.rowsLayout,
    entries: [
      { binding: 0, resource: { buffer: inputs.pages } },
      { binding: 1, resource: { buffer } },
      { binding: 2, resource: inputs.vis },
      { binding: 3, resource: { buffer: passes.work } },
    ],
  })
  c.trisGroup = device.createBindGroup({
    layout: passes.trisLayout,
    entries: [
      ...buffers.map((source, binding) => ({ binding, resource: { buffer: source } })),
      { binding: 5, resource: { buffer: inputs.uniform } },
      { binding: 6, resource: inputs.normals },
    ],
  })
}

export type ShadeCache = Awaited<ReturnType<typeof createShadeCache>>
