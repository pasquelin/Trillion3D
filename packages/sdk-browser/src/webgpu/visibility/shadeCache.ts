import { createCheckedShaderModule } from '../../gpu/core/shaderModule.ts'
import { validated } from '../../gpu/core/errorScope.ts'
import { buildComputeStages } from '../../lighting/deferred/fullscreen.ts'
import { DEFAULT_GROUP_WIDTH, dispatchGrid, groupWidth } from '../../gpu/dag/shader/gridWgsl.ts'
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
  SHADE_CACHE_SHADER,
  SHADE_ROWS_LANES,
  SHADE_TRIS_SHADER,
  TRIANGLE_WORDS,
} from '../../visibility/shader/shadeCacheWgsl.ts'

/** The material cache's A/B in the host URL, temporary, each read once at preparation; the same
 *  image every way. `trillion3dShadeNoCache=1`: no pass encoded, every pixel composes and decodes
 *  its own (`SHADE_CACHE` left out). */
const shadeNoCacheAsked = heldSwitch('trillion3dShadeNoCache')
/** The pipeline constant that turns the cache on in the shade and the triangles passes. */
const CACHED = { SHADE_CACHE: 1 }

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

/** The passes' pipelines and layouts, for what the session caches; none on a device with no
 *  compute or that refuses them. */
async function cachePasses(device: GPUDevice) {
  if (typeof device.createComputePipeline !== 'function') return
  const compute = GPUShaderStage.COMPUTE,
    readOnly: GPUBufferBindingLayout = { type: 'read-only-storage' },
    storage: GPUBufferBindingLayout = { type: 'storage' }
  const span = groupWidth(device.limits)
  return validated(device, async () => {
    const [rowsModule, trisModule] = await Promise.all([
      createCheckedShaderModule(device, SHADE_CACHE_SHADER, 'SHADE_CACHE'),
      createCheckedShaderModule(device, SHADE_TRIS_SHADER, 'SHADE_TRIS'),
    ])
    const rowsLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: compute, buffer: readOnly },
        { binding: 1, visibility: compute, buffer: storage },
        { binding: 2, visibility: compute, texture: { sampleType: 'uint' } },
        { binding: 3, visibility: compute, buffer: storage },
      ],
    })
    const trisLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: compute, buffer: readOnly },
        { binding: 1, visibility: compute, buffer: storage },
        ...[2, 3, 4].map((binding) => ({ binding, visibility: compute, buffer: readOnly })),
        { binding: 5, visibility: compute, buffer: { type: 'uniform' } },
        {
          binding: 6,
          visibility: compute,
          texture: { sampleType: 'unfilterable-float', viewDimension: '2d-array' },
        },
      ] as GPUBindGroupLayoutEntry[],
    })
    const layoutOf = (layout: GPUBindGroupLayout) =>
      device.createPipelineLayout({ bindGroupLayouts: [layout] })
    const [rows, triangles] = await Promise.all([
      buildComputeStages(
        device,
        layoutOf(rowsLayout),
        rowsModule,
        ['shade_clear', 'shade_marks', 'shade_rows'],
        { ...CACHED, ...(span !== DEFAULT_GROUP_WIDTH && { GROUP_WIDTH: span }) },
      ),
      buildComputeStages(device, layoutOf(trisLayout), trisModule, ['shade_tris'], CACHED),
    ])
    const work = device.createBuffer({
      label: 'Trillion3D material cache dispatch',
      size: 12,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST,
    })
    // One deep; x and y, cleared each image, raised by the rows that fit (`openSlice`).
    device.queue.writeBuffer(work, 8, new Uint32Array([1]))
    return { rowsLayout, trisLayout, span, work, ...rows, shade_tris: triangles.shade_tris }
  })
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
  // The header words the host writes, the rows and the capacity; the cursor and the end of the
  // fitting slots, which the passes raise, the pass's first dispatch zeroes (`shade_clear`).
  const header = new Uint32Array(SHADE_CACHE_HEADER_WORDS)
  // The image's grids, laid with its rows: the clear's, one lane per mark word, and the rows'.
  let clearGrid: [number, number] = [0, 0],
    rowsGrid: [number, number] = [0, 0]
  const make = (words: number) =>
    device.createBuffer({
      label: 'Trillion3D material cache',
      size: words * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })
  let buffer = make(SHADE_CACHE_HEADER_WORDS),
    words = SHADE_CACHE_HEADER_WORDS,
    rowsGroup: GPUBindGroup | undefined,
    trisGroup: GPUBindGroup | undefined,
    width = 0,
    height = 0
  const bound = createWebgpuBindIdentity()
  const constants: Record<string, number> = { ...(passes && CACHED) }
  return {
    constants,
    get buffer() {
      return buffer
    },
    /**
     * Lays the sections for `tableRows` rows of at most `maxCorners` corners and a `pixelWidth` ×
     * `pixelHeight` visibility buffer, the buffer grown to hold them, and writes the header words
     * the passes and the resolve read — the rows, the capacity — when they changed.
     */
    layFor(tableRows: number, maxCorners: number, pixelWidth: number, pixelHeight: number) {
      const rows = passes ? tableRows : 0,
        capacity = Math.min(
          rows * Math.min(Math.ceil(maxCorners / 3), ROW_TRIANGLES),
          Math.floor((pixelWidth * pixelHeight) / TRIANGLE_WORDS),
        )
      const needed =
        SHADE_CACHE_HEADER_WORDS +
        rows * (ROW_RECORD_WORDS + ROW_MARK_WORDS) +
        capacity * TRIANGLE_WORDS
      if (needed > words) {
        buffer.destroy()
        buffer = make((words = needed))
      }
      width = pixelWidth
      height = pixelHeight
      if (rows !== header[SHADE_CACHE_ROWS_WORD] && passes) {
        clearGrid = dispatchGrid(Math.ceil((rows * ROW_MARK_WORDS) / SHADE_ROWS_LANES), passes.span)
        rowsGrid = dispatchGrid(Math.ceil(rows / SHADE_ROWS_LANES), passes.span)
      }
      header[SHADE_CACHE_ROWS_WORD] = rows
      header[SHADE_CACHE_CAPACITY_WORD] = capacity
      // The words that changed; a new buffer is held as its zeros (`vsmWriteChanged`).
      vsmWriteChanged(device, buffer, header, SHADE_CACHE_ROWS_WORD, SHADE_CACHE_CAPACITY_WORD + 1)
    },
    /** The image's passes, as dispatches of the frame's compute pass, before the class draws
     *  read what they store: the marks cleared, then marks, rows and triangles — the fitting
     *  slots' alone, at the size the rows pass wrote. None when no row is laid: rows are zero
     *  on a device that refused the passes. */
    encode(open: OpenPass, inputs: ShadeCacheInputs) {
      if (!passes || !header[SHADE_CACHE_ROWS_WORD]) return
      const n = bound.next
      n[0] = buffer
      n[1] = inputs.pages
      n[2] = inputs.vis
      n[3] = inputs.indices
      n[4] = inputs.positions
      n[5] = inputs.uvs
      n[6] = inputs.uniform
      n[7] = inputs.normals
      if (bound.moved() || !rowsGroup) {
        const buffers = [inputs.pages, buffer, inputs.indices, inputs.positions, inputs.uvs]
        rowsGroup = device.createBindGroup({
          layout: passes.rowsLayout,
          entries: [
            { binding: 0, resource: { buffer: inputs.pages } },
            { binding: 1, resource: { buffer } },
            { binding: 2, resource: inputs.vis },
            { binding: 3, resource: { buffer: passes.work } },
          ],
        })
        trisGroup = device.createBindGroup({
          layout: passes.trisLayout,
          entries: [
            ...buffers.map((source, binding) => ({ binding, resource: { buffer: source } })),
            { binding: 5, resource: { buffer: inputs.uniform } },
            { binding: 6, resource: inputs.normals },
          ],
        })
      }
      const pass = open.pass
      // The marks and the triangles' dispatch start from zero: the pass's first dispatch.
      pass.setPipeline(passes.shade_clear)
      pass.setBindGroup(0, rowsGroup)
      pass.dispatchWorkgroups(clearGrid[0], clearGrid[1])
      pass.setPipeline(passes.shade_marks)
      pass.dispatchWorkgroups(Math.ceil(width / MARK_TILE), Math.ceil(height / MARK_TILE))
      pass.setPipeline(passes.shade_rows)
      pass.dispatchWorkgroups(rowsGrid[0], rowsGrid[1])
      pass.setPipeline(passes.shade_tris)
      pass.setBindGroup(0, trisGroup)
      pass.dispatchWorkgroupsIndirect(passes.work, 0)
    },
    dispose() {
      buffer.destroy()
      passes?.work.destroy()
    },
  }
}

export type ShadeCache = Awaited<ReturnType<typeof createShadeCache>>
