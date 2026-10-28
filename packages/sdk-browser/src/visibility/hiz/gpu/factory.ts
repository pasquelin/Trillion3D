import { allocPyramid, encodeHizPyramid, type Pyramid } from './pyramid.ts'
import { hizUniformSlots } from './uniforms.ts'
import { HIZ_LEVELS } from './pyramidTexture.ts'
import { createHizPipelines, createHizWorkPipelines } from './pipelines.ts'
import { createWebgpuBindIdentity } from '../../../gpu/bind/bindIdentity.ts'
import type { HizWorkSource } from './workDepthSource.ts'
import { encodePrimedLayer } from './primed.ts'
import { destroyAll } from '../../../gpu/core/errorScope.ts'
import type { GpuHiz } from './types.ts'
import type { OpenPass } from '../../../gpu/core/lazyComputePass.ts'
import {
  bindHiz,
  bindWork,
  hizExtent,
  hizFront,
  hizPlanes,
  hizResize,
  installHiz,
  type HizPipelines,
  type HizWorkPipelines,
  type HizState,
} from './hizOps.ts'

/** The frame's depth pyramid (`shader.ts`): reverse-Z, its farthest layer for the occlusion, its
 *  nearest for the readers of the whole depth. Without compute, returns `undefined`. Its level 0
 *  holds the opaque depth and, while its transparents write it (`front`), the nearest transparent
 *  surface's beside it, which the transparents' front pass writes (`lighting/reflections/frontLayer.ts`); zero
 *  where none lies, whose fold is the opaque depth, bit for bit. */
export async function createGpuHiz(
  device: GPUDevice,
  width: number,
  height: number,
): Promise<GpuHiz | undefined> {
  if (width < 1 || height < 1) return undefined
  const buffers: GPUBuffer[] = []
  let h: HizState | undefined
  try {
    const [pipelines, work] = await Promise.all([
      createHizPipelines(device),
      createHizWorkPipelines(device),
    ])
    if (!pipelines || !work) return undefined
    h = hizState(device, pipelines, work, buffers)
    const first = (h.at = allocPyramid(device, h.level0Usage, width, height, h.slots))
    const gpu = hizApi(h, first)
    installHiz(h, gpu, first)
    return gpu
  } catch {
    destroyAll([...buffers, h?.at])
    return undefined
  }
}

/** The Hi-Z's buffers, made before its first pyramid. */
function hizState(
  device: GPUDevice,
  pipelines: HizPipelines,
  work: HizWorkPipelines,
  buffers: GPUBuffer[],
): HizState {
  // The deepest pyramid's build passes, at the device's alignment.
  const slots = hizUniformSlots(device.limits)
  const uniforms = device.createBuffer({
    label: 'Trillion3D HiZ uniforms',
    size: slots.bytes,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  // `COPY_SRC`: the cut keeps the levels each pyramid was built with (`../../../frame/render/cutPyramid.ts`).
  const levels = device.createBuffer({
    label: 'Trillion3D Hi-Z levels',
    size: HIZ_LEVELS.words * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  })
  buffers.push(uniforms, levels)
  return {
    ...pipelines,
    device,
    // `COPY_SRC` and `COPY_DST` serve the proof tools, which reread depth and lay their own. The
    // front layer is written by the transparents' fold, a storage texture, and cleared as an
    // attachment.
    level0Usage:
      GPUTextureUsage.RENDER_ATTACHMENT |
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.STORAGE_BINDING |
      GPUTextureUsage.COPY_SRC |
      GPUTextureUsage.COPY_DST,
    uniforms,
    levelTable: levels,
    slots,
    // Only the words that changed go up: a frame of the same size sends nothing.
    image: new Uint32Array(slots.bytes / 4),
    buffers,
    disposed: false,
    at: undefined,
    bindGroup: undefined,
    work,
    source: { identity: createWebgpuBindIdentity(), group: undefined },
  }
}

/** The drawn pyramid built by `pipeline`, in the open compute pass. */
function encodeLayer(h: HizState, open: OpenPass, pipeline: GPUComputePipeline) {
  bindHiz(h)
  const { at, bindGroup } = h
  if (h.disposed || !bindGroup || !at) return
  encodeHizPyramid(open.pass, bindGroup, pipeline, at.drawn.passes, at.drawn.slots)
}

/** The image's own build, over the visibility buffer `source`, in the open compute pass. */
function encodeFromWork(h: HizState, open: OpenPass, source: HizWorkSource, full: boolean) {
  bindHiz(h)
  const { at } = h
  if (h.disposed || !at) throw new Error('HIZ_BUILD_UNAVAILABLE')
  const group = bindWork(h, at, source)
  open.pass.setBindGroup(1, h.source.group)
  const { fullPipeline, buildPipeline } = h.work
  // The first pass runs over the whole of level 0: it writes the background past the drawn size.
  encodeHizPyramid(
    open.pass,
    group,
    full ? fullPipeline : buildPipeline,
    at.drawn.passes,
    at.drawn.slots,
    at,
  )
}

/** The Hi-Z's face (`GpuHiz`), over `h`, its first pyramid `first` in place. */
function hizApi(h: HizState, first: Pyramid): GpuHiz {
  const gpu: GpuHiz = {
    width: 0,
    height: 0,
    level0: first.level0,
    level0View: first.level0View,
    // Every layer it builds, four mips per dispatch (`buildHiz`), in the frame's compute pass.
    encodePyramid: (open) => encodeLayer(h, open, h.buildPipeline),
    encodeFull: (open) => encodeLayer(h, open, h.fullPipeline),
    encodeFromWork: (open, source, full) => encodeFromWork(h, open, source, full),
    encodePrimed: (open, push) => encodePrimedLayer(h, open, push),
    levelTable: h.levelTable,
    extent: (drawnWidth, drawnHeight) => hizExtent(h, drawnWidth, drawnHeight),
    pyramidView: () => (h.disposed ? undefined : h.at?.pyramidView),
    front: (wanted) => hizFront(h, wanted),
    planes: (wanted) => hizPlanes(h, wanted),
    depth() {
      if (h.disposed) return undefined
      bindHiz(h)
      const { at } = h
      if (!at) return undefined
      return (at.depth ??= {
        resources: [at.depthView, at.pyramidView, { buffer: h.levelTable }],
      })
    },
    resize: (nextDevice, nextWidth, nextHeight) =>
      hizResize(h, gpu, nextDevice, nextWidth, nextHeight),
    swap(next) {
      const current = h.at
      if (!h.disposed) installHiz(h, gpu, next as Pyramid | undefined)
      return current
    },
    dispose() {
      h.disposed = true
      for (const buffer of h.buffers) buffer.destroy()
      h.at?.destroy()
      h.at = h.bindGroup = undefined
    },
  }
  return gpu
}
