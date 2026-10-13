import { allocPyramid, pyramidLayout, type Pyramid } from './pyramid.ts'
import { HIZ_SLOT_WORDS, hizTestSlot } from './uniforms.ts'
import type { UniformSlots } from '../../residency/pools.ts'
import { writeChangedSlots } from '../core/writeChanged.ts'
import { pendingBuffers } from '../core/tableGrowth.ts'
import type { OpenPass } from '../core/lazyComputePass.ts'
import type { createHizPipelines, hizPagesGroup } from './pipelines.ts'
import type { GpuHiz } from './types.ts'
import { sequentialEntries } from '../core/computeBindings.ts'
import { createWebgpuBindIdentity } from '../../webgpu/core/bindIdentity.ts'

export type HizPipelines = NonNullable<Awaited<ReturnType<typeof createHizPipelines>>>

/** What the Hi-Z's methods share (`factory.ts`, here): its kernels, its buffers, the
 *  drawn view's pyramid `at` and its bind group, and the partition's buffers once attached. */
export type HizState = HizPipelines & {
  device: GPUDevice
  level0Usage: number
  pagesGroup: ReturnType<typeof hizPagesGroup>
  /** The test's dispatch arguments, written on the GPU from the partition's box count
   *  (`testHizArgs`), and the group that binds them to the kernel that writes them. */
  testArgs: GPUBuffer
  testArgsGroup: GPUBindGroup
  uniforms: GPUBuffer
  /** The uniform's slots (`hizUniformSlots`): their stride, offsets and the words they hold. */
  slots: UniformSlots
  /** Every word the kernels read: the drawn pyramid's build passes from word zero
   *  (`hizBuildWords`), the test's slot behind them (`hizTestSlot`). */
  image: Uint32Array<ArrayBuffer>
  /** The drawn pyramid's levels uniform (`hizLevelWords`), which the readers of the whole depth
   *  bind (`GpuHiz.depth`). */
  levelTable: GPUBuffer
  /** Until `attach`, the bind group points at this idle buffer, which nothing reads. */
  idle: GPUBuffer
  buffers: GPUBuffer[]
  disposed: boolean
  /** The drawn view's pyramid; another view keeps its own while this one is drawn (`swap`). */
  at: Pyramid | undefined
  bindGroup: GPUBindGroup | undefined
  bounds: GPUBuffer
  state: GPUBuffer
  flags: GPUBuffer
  cap: number
  /** The front depth the drawn pyramid folds in, read at each use (`createGpuHiz`). */
  front: (() => GPUTextureView | undefined) | undefined
}

/** Verdict flags for `rows` rows. */
export const hizFlags = (device: GPUDevice, rows: number) =>
  device.createBuffer({
    size: Math.max(4, rows * 4),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  })

/** The drawn pyramid's bind group, made again when the front depth — the one `h.front` gives now,
 *  else level 0 — or a buffer it names moved (`createWebgpuBindIdentity`: an `attach`, a growth of
 *  the flags), never per swap; what its readers bind (`at.depth`) goes with it when the front
 *  changed. */
export function bindHiz(h: HizState) {
  const { at } = h
  if (!at) return void (h.bindGroup = undefined)
  const front = h.front?.() ?? at.level0View
  if (at.frontView !== front) {
    at.frontView = front
    at.depth = undefined
  }
  const bound = (at.bound ??= createWebgpuBindIdentity()),
    { next } = bound
  next[0] = front
  next[1] = h.uniforms
  next[2] = h.bounds
  next[3] = h.flags
  next[4] = h.state
  if (bound.moved())
    at.group = h.device.createBindGroup({
      layout: h.layout,
      entries: sequentialEntries([
        at.pyramidView,
        at.level0View,
        { buffer: h.uniforms, size: HIZ_SLOT_WORDS * 4 },
        { buffer: h.bounds },
        { buffer: h.flags },
        { buffer: h.state },
        at.frontView,
      ]),
    })
  h.bindGroup = at.group
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
 *  holds that changed go up, as a whole compare at 256 bytes sends them; and its levels uniform. */
function sendHizBuild(h: HizState, { passes, words, levelWords }: Pyramid['drawn']) {
  h.image.set(words, 0)
  writeChangedSlots(h.device, h.uniforms, h.image, h.slots, 0, passes.length)
  h.device.queue.writeBuffer(h.levelTable, 0, levelWords)
}

/** Verdict flags for `rows` rows, made now and put in place by `commit` (`GpuHiz.growFlags`). */
export function hizGrowFlags(h: HizState, gpu: GpuHiz, rows: number) {
  const next = hizFlags(h.device, rows)
  return pendingBuffers([next], () => {
    const old = h.flags
    h.buffers[h.buffers.indexOf(old)] = gpu.flags = h.flags = next
    h.cap = rows
    // Every pyramid's group names the flags: each is made again at its next bind (`bindHiz`).
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
  bindHiz(h)
  const { at, bindGroup, image } = h
  if (h.disposed || !bindGroup || !at || h.bounds === h.idle) return 0
  const rows = Math.min(maxRows, h.cap)
  const { passes, width: w, height: hh } = at.drawn,
    slot = passes.length
  hizTestSlot(image, slot * h.slots.strideWords, w, hh, rows, counting)
  writeChangedSlots(queueDevice, h.uniforms, image, h.slots, slot, slot + 1)
  // The compacted box count lives in the state: a kernel turns it into the dispatch's arguments,
  // which cover the tested boxes and no other row; the threads past the count leave at the first
  // test.
  const pass = open.pass
  pass.setBindGroup(0, bindGroup, h.slots.offset(slot))
  pass.setBindGroup(1, h.testArgsGroup)
  pass.setPipeline(h.argsPipeline)
  pass.dispatchWorkgroups(1)
  pass.setBindGroup(1, h.pagesGroup(pages))
  pass.setPipeline(h.testPipeline)
  pass.dispatchWorkgroupsIndirect(h.testArgs, 0)
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
