import { allocPyramid, pyramidLayout, type Pyramid } from './pyramid.ts'
import { HIZ_SLOT_WORDS, hizTestSlot } from './uniforms.ts'
import type { UniformSlots } from '../../residency/pools.ts'
import { vsmWriteChangedSlots } from '../../vsm/writeChanged.ts'
import { pendingBuffers } from '../core/tableGrowth.ts'
import type { OpenPass } from '../core/lazyComputePass.ts'
import type { createHizPipelines, hizPagesGroup } from './pipelines.ts'
import type { GpuHiz } from './types.ts'
import { workgroupCount } from '../../../../math/src/scalar/integers.ts'
import { dispatchRows } from '../dispatch/grid.ts'

const TEST_WORKGROUP = 64

export type HizPipelines = NonNullable<Awaited<ReturnType<typeof createHizPipelines>>>

/** What the Hi-Z's methods share (`factory.ts`, here): its kernels, its buffers, the
 *  drawn view's pyramid `at` and its bind group, and the partition's buffers once attached. */
export type HizState = HizPipelines & {
  device: GPUDevice
  level0Usage: number
  pagesGroup: ReturnType<typeof hizPagesGroup>
  uniforms: GPUBuffer
  /** The uniform's slots (`hizUniformSlots`): their stride, offsets and the words they hold. */
  slots: UniformSlots
  /** Every word the kernels read: the drawn pyramid's build passes from word zero
   *  (`hizBuildWords`), the test's slot behind them (`hizTestSlot`). */
  image: Uint32Array<ArrayBuffer>
  /** Until `attach`, the bind group points at this idle buffer, which nothing reads. */
  idle: GPUBuffer
  buffers: GPUBuffer[]
  disposed: boolean
  /** The drawn view's pyramid; another view keeps its own while this one is drawn (`swap`). */
  at: Pyramid | undefined
  bindGroup: GPUBindGroup | undefined
  /** Bumped when the partition's buffers change: a pyramid's cached bind group is then stale. */
  bindings: number
  bounds: GPUBuffer
  state: GPUBuffer
  flags: GPUBuffer
  cap: number
}

/** Verdict flags for `rows` rows. */
export const hizFlags = (device: GPUDevice, rows: number) =>
  device.createBuffer({
    size: Math.max(4, rows * 4),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  })

/** The drawn pyramid's bind group, made once per pyramid and per `attach`, never per swap. */
export function bindHiz(h: HizState) {
  const { at } = h
  if (!at) return void (h.bindGroup = undefined)
  if (at.group && at.bindings === h.bindings) return void (h.bindGroup = at.group)
  at.bindings = h.bindings
  h.bindGroup = at.group = h.device.createBindGroup({
    layout: h.layout,
    entries: [
      { binding: 0, resource: { buffer: at.pyramid } },
      { binding: 1, resource: at.level0View },
      { binding: 2, resource: { buffer: h.uniforms, size: HIZ_SLOT_WORDS * 4 } },
      { binding: 3, resource: { buffer: h.bounds } },
      { binding: 4, resource: { buffer: h.flags } },
      { binding: 5, resource: { buffer: h.state } },
    ],
  })
}

/** Installs `next` as the drawn pyramid: bound, its build words written, its size published. */
export function installHiz(h: HizState, gpu: GpuHiz, next: Pyramid | undefined) {
  h.at = next
  bindHiz(h)
  gpu.width = next?.width ?? 0
  gpu.height = next?.height ?? 0
  if (!next) return
  sendHizBuild(h, next.drawn)
  gpu.level0 = next.level0
  gpu.level0View = next.level0View
}

/** The drawn pyramid's build words, from word zero: of each pass's slot, the words its struct
 *  holds that changed go up, as a whole compare at 256 bytes sends them. */
function sendHizBuild(h: HizState, { passes, words }: Pyramid['drawn']) {
  h.image.set(words, 0)
  vsmWriteChangedSlots(h.device, h.uniforms, h.image, h.slots, 0, passes.length)
}

/** Verdict flags for `rows` rows, made now and put in place by `commit` (`GpuHiz.growFlags`). */
export function hizGrowFlags(h: HizState, gpu: GpuHiz, rows: number) {
  const next = hizFlags(h.device, rows)
  return pendingBuffers([next], () => {
    const old = h.flags
    h.buffers[h.buffers.indexOf(old)] = gpu.flags = h.flags = next
    h.cap = rows
    // Every pyramid's group names the flags: each is made again at its next install.
    h.bindings++
    bindHiz(h)
    return [old]
  })
}

/** The `drawnWidth × drawnHeight` the image draws in level 0 (`GpuHiz.extent`). */
export function hizExtent(h: HizState, drawnWidth: number, drawnHeight: number) {
  const { at } = h
  if (h.disposed || !at) return
  // Never past level 0: a pyramid still at another view's size is resized before it draws.
  const w = Math.min(at.width, drawnWidth),
    hh = Math.min(at.height, drawnHeight)
  if (at.drawn.width === w && at.drawn.height === hh) return
  at.drawn = pyramidLayout(w, hh, h.slots)
  sendHizBuild(h, at.drawn)
}

/** The test of the compacted boxes, in the frame's compute pass (`GpuHiz.encodeTest`). */
export function hizTest(
  h: HizState,
  queueDevice: GPUDevice,
  open: OpenPass,
  maxRows: number,
  pages: GPUBuffer,
  counting: boolean,
) {
  const { at, bindGroup, image } = h
  if (h.disposed || !bindGroup || !at || h.bounds === h.idle) return 0
  const rows = Math.min(maxRows, h.cap)
  const { passes, width: w, height: hh } = at.drawn,
    slot = passes.length
  hizTestSlot(image, slot * h.slots.strideWords, w, hh, rows, counting)
  vsmWriteChangedSlots(queueDevice, h.uniforms, image, h.slots, slot, slot + 1)
  // The compacted box count lives in the state: the dispatch covers every drawable row
  // and threads past the count leave at the first test.
  const pass = open.pass
  pass.setPipeline(h.testPipeline)
  pass.setBindGroup(0, bindGroup, h.slots.offset(slot))
  pass.setBindGroup(1, h.pagesGroup(pages))
  dispatchRows(pass, workgroupCount(rows, TEST_WORKGROUP))
  return rows
}

/** The drawn view's pyramid made again at `width × height` (`GpuHiz.resize`). */
export function hizResize(
  h: HizState,
  gpu: GpuHiz,
  nextDevice: GPUDevice,
  width: number,
  height: number,
) {
  if (h.disposed || !nextDevice || width < 1 || height < 1) return false
  if (width === gpu.width && height === gpu.height && h.at) return true
  try {
    // The drawn view's pyramid is replaced; another view's, held aside, is not touched.
    h.at?.destroy()
    installHiz(h, gpu, allocPyramid(h.device, h.level0Usage, width, height, h.slots))
    return true
  } catch {
    return false
  }
}
