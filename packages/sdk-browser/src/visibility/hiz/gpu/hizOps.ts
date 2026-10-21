import { allocPyramid, pyramidLayout, type Pyramid } from './pyramid.ts'
import { HIZ_SLOT_WORDS, HIZ_UNI } from './uniforms.ts'
import { HIZ_LEVELS_FRONT_WORD } from './levelsUniform.ts'
import type { UniformSlots } from '../../../session/memory/pools.ts'
import { writeChangedSlots } from '../../../gpu/core/writeChanged.ts'
import type { createHizPipelines } from './pipelines.ts'
import type { GpuHiz } from './types.ts'
import { sequentialEntries } from '../../../gpu/core/computeBindings.ts'

export type HizPipelines = NonNullable<Awaited<ReturnType<typeof createHizPipelines>>>

/** What the Hi-Z's methods share (`factory.ts`, here): its kernels, its buffers, and the
 *  drawn view's pyramid `at` and its bind group. */
export type HizState = HizPipelines & {
  device: GPUDevice
  level0Usage: number
  uniforms: GPUBuffer
  /** The uniform's slots (`hizUniformSlots`): their stride, offsets and the words they hold. */
  slots: UniformSlots
  /** Every word the kernels read: the drawn pyramid's build passes from word zero
   *  (`hizBuildWords`). */
  image: Uint32Array<ArrayBuffer>
  /** The drawn pyramid's levels uniform (`hizLevelWords`), which the readers of the whole depth
   *  bind (`GpuHiz.depth`). */
  levelTable: GPUBuffer
  buffers: GPUBuffer[]
  disposed: boolean
  /** The drawn view's pyramid; another view keeps its own while this one is drawn (`swap`). */
  at: Pyramid | undefined
  bindGroup: GPUBindGroup | undefined
}

/** The drawn pyramid's bind group, made with the pyramid, never per swap: its own views and the
 *  Hi-Z's uniform, which lives as long as the Hi-Z. */
export function bindHiz(h: HizState) {
  const { at } = h
  if (!at) return void (h.bindGroup = undefined)
  at.group ??= h.device.createBindGroup({
    layout: h.layout,
    entries: sequentialEntries([
      at.pyramidView,
      at.depthView,
      { buffer: h.uniforms, size: HIZ_SLOT_WORDS * 4 },
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
  sendHizBuild(h, next)
  gpu.level0 = next.level0
  gpu.level0View = next.level0View
}

/** The drawn pyramid's build words, from word zero: of each pass's slot, the words its struct
 *  holds that changed go up, as a whole compare at 256 bytes sends them; and its levels uniform.
 *  Both carry its front word (`Pyramid.frontWritten`): the first pass's, which reads level 0. */
function sendHizBuild(h: HizState, { drawn, frontWritten }: Pyramid) {
  const front = frontWritten ? 1 : 0
  h.image.set(drawn.words, 0)
  h.image[HIZ_UNI.at.front] = front
  writeChangedSlots(h.device, h.uniforms, h.image, h.slots, 0, drawn.passes.length)
  drawn.levelWords[HIZ_LEVELS_FRONT_WORD] = front
  h.device.queue.writeBuffer(h.levelTable, 0, drawn.levelWords)
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
  sendHizBuild(h, at)
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

/** The drawn pyramid's front layer (`GpuHiz.front`), folded exactly while `wanted`: its front
 *  word sent when it moved, so an image that does not write it folds the opaque depth alone. */
export function hizFront(h: HizState, wanted: boolean) {
  const { at } = h
  if (h.disposed || !at) return undefined
  if (at.frontWritten !== wanted) {
    at.frontWritten = wanted
    sendHizBuild(h, at)
  }
  return wanted ? at.frontView : undefined
}
