import { allocPyramid, encodeHizPyramid, type Pyramid } from './pyramid.ts'
import { hizUniformSlots } from './uniforms.ts'
import { HIZ_LEVELS_WORDS } from './pyramidTexture.ts'
import { cleanupFailedHiz, createHizPipelines, hizArgsGroup, hizPagesGroup } from './pipelines.ts'
import { HIZ_TEST_ARGS_BYTES } from './shader.ts'
import { TESTED_U32 } from '../partition/contract.ts'
import type { GpuHiz } from './types.ts'
import type { OpenPass } from '../core/lazyComputePass.ts'
import {
  bindHiz,
  hizExtent,
  hizFlags,
  hizGrowFlags,
  hizResize,
  hizTest,
  installHiz,
  type HizPipelines,
  type HizState,
} from './hizOps.ts'

/** The frame's depth pyramid (`shader.ts`): reverse-Z, its farthest layer for the occlusion, its
 *  nearest for the readers of the whole depth. Without compute, returns `undefined`. `front` gives
 *  the nearest transparent surface's depth the pyramid folds in — the drawn view's reflection's
 *  (`reflections/frontDepth.ts`), read at each use, so a view switch or a remade reflection is
 *  followed —; none, and the pyramid binds level 0 there, whose fold with itself is the opaque
 *  depth, bit for bit. */
export async function createGpuHiz(
  device: GPUDevice,
  width: number,
  height: number,
  maxBounds: number,
  front?: () => GPUTextureView | undefined,
): Promise<GpuHiz | undefined> {
  if (width < 1 || height < 1) return undefined
  const buffers: GPUBuffer[] = []
  let h: HizState | undefined
  try {
    const pipelines = await createHizPipelines(device)
    if (!pipelines) return undefined
    h = hizState(device, pipelines, buffers, Math.max(1, maxBounds), front)
    const first = (h.at = allocPyramid(device, h.level0Usage, width, height, h.slots))
    const gpu = hizApi(h, first)
    installHiz(h, gpu, first)
    return gpu
  } catch {
    cleanupFailedHiz(buffers, h?.at)
    return undefined
  }
}

/** The Hi-Z's buffers, made before its first pyramid. */
function hizState(
  device: GPUDevice,
  pipelines: HizPipelines,
  buffers: GPUBuffer[],
  cap: number,
  front: HizState['front'],
): HizState {
  // The deepest pyramid's build passes, then the test's slot, at the device's alignment.
  const slots = hizUniformSlots(device.limits)
  const uniforms = device.createBuffer({
    label: 'Trillion3D HiZ uniforms',
    size: slots.bytes,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  // Tested boxes and the frame state belong to the GPU partition, which does not exist yet.
  const idle = device.createBuffer({
    label: 'Trillion3D HiZ idle bounds v1',
    size: TESTED_U32 * 4,
    usage: GPUBufferUsage.STORAGE,
  })
  const flags = hizFlags(device, cap)
  const levels = device.createBuffer({
    label: 'Trillion3D Hi-Z levels',
    size: HIZ_LEVELS_WORDS * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const testArgs = device.createBuffer({
    label: 'Trillion3D Hi-Z test arguments',
    size: HIZ_TEST_ARGS_BYTES,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT,
  })
  buffers.push(uniforms, idle, flags, levels, testArgs)
  return {
    ...pipelines,
    device,
    // `COPY_SRC` and `COPY_DST` serve only the proof tools, which reread depth and lay their own;
    // no frame copies.
    level0Usage:
      GPUTextureUsage.RENDER_ATTACHMENT |
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.COPY_SRC |
      GPUTextureUsage.COPY_DST,
    pagesGroup: hizPagesGroup(device, pipelines.pagesLayout),
    testArgs,
    testArgsGroup: hizArgsGroup(device, pipelines.argsLayout, testArgs),
    uniforms,
    levelTable: levels,
    slots,
    // Only the words that changed go up: a frame of the same size and rows sends nothing.
    image: new Uint32Array(slots.bytes / 4),
    idle,
    buffers,
    disposed: false,
    at: undefined,
    bindGroup: undefined,
    bounds: idle,
    state: idle,
    flags,
    cap,
    front,
  }
}

/** One layer of the drawn pyramid, by its build's `pipeline`, in the open compute pass. */
function encodeLayer(h: HizState, open: OpenPass, pipeline: GPUComputePipeline) {
  bindHiz(h)
  const { at, bindGroup } = h
  if (h.disposed || !bindGroup || !at) return
  encodeHizPyramid(open.pass, bindGroup, pipeline, at.drawn.passes, at.drawn.slots)
}

/** The Hi-Z's face (`GpuHiz`), over `h`, its first pyramid `first` in place. */
function hizApi(h: HizState, first: Pyramid): GpuHiz {
  const gpu: GpuHiz = {
    width: 0,
    height: 0,
    level0: first.level0,
    level0View: first.level0View,
    flags: h.flags,
    // A whole layer, four mips per dispatch (`buildHiz`), in the frame's compute pass.
    encodePyramid: (open) => encodeLayer(h, open, h.buildPipeline),
    encodeNearest: (open) => encodeLayer(h, open, h.nearestPipeline),
    /** Tested boxes and the frame state come from the GPU partition, mounted after us. */
    attach(nextBounds: GPUBuffer, nextState: GPUBuffer) {
      h.bounds = nextBounds
      h.state = nextState
      bindHiz(h)
    },
    growFlags: (rows) => hizGrowFlags(h, gpu, rows),
    /** Pyramid mips, with their offset and width: what the partition reads to express a
     *  screen rectangle in texels of the mip that covers it exactly. */
    levels: () => h.at?.drawn.levels ?? [],
    extent: (drawnWidth, drawnHeight) => hizExtent(h, drawnWidth, drawnHeight),
    pyramidView: () => (h.disposed ? undefined : h.at?.pyramidView),
    depth() {
      if (h.disposed) return undefined
      bindHiz(h)
      const { at } = h
      if (!at) return undefined
      return (at.depth ??= {
        resources: [at.level0View, at.pyramidView, { buffer: h.levelTable }, at.frontView],
      })
    },
    encodeTest: (queueDevice, open, maxRows, pages, counting) =>
      hizTest(h, queueDevice, open, maxRows, pages, counting),
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
