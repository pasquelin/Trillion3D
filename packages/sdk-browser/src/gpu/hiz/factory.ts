import { allocPyramid, encodeHizPyramid, type Pyramid } from './pyramid.ts'
import { HIZ_MAX_LEVELS, HIZ_PASS_LEVELS } from './uniforms.ts'
import { uniformStride } from '../../residency/pools.ts'
import { cleanupFailedHiz, createHizPipelines, hizPagesGroup } from './pipelines.ts'
import { TESTED_U32 } from '../partition/contract.ts'
import type { GpuHiz } from './types.ts'
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
import { ceilDiv } from '../../../../math/src/scalar/integers.ts'

/** Frame Hi-Z: reverse-Z, reduce to the minimum. Without compute, returns `undefined`. */
export async function createGpuHiz(
  device: GPUDevice,
  width: number,
  height: number,
  maxBounds: number,
): Promise<GpuHiz | undefined> {
  if (typeof device.createComputePipeline !== 'function' || width < 1 || height < 1)
    return undefined
  const buffers: GPUBuffer[] = []
  let h: HizState | undefined
  try {
    const pipelines = await createHizPipelines(device)
    if (!pipelines) return undefined
    h = hizState(device, pipelines, buffers, Math.max(1, maxBounds))
    const first = (h.at = allocPyramid(device, h.level0Usage, width, height, h.stride))
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
): HizState {
  // The slots lie at the device's dynamic-offset alignment.
  const stride = uniformStride(device.limits)
  const uniforms = device.createBuffer({
    label: 'Trillion3D HiZ uniforms',
    // The deepest pyramid's build passes, then the test's slot.
    size: stride * (ceilDiv(HIZ_MAX_LEVELS - 1, HIZ_PASS_LEVELS) + 1),
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  // Tested boxes and the frame state belong to the GPU partition, which does not exist yet.
  const idle = device.createBuffer({
    label: 'Trillion3D HiZ idle bounds v1',
    size: TESTED_U32 * 4,
    usage: GPUBufferUsage.STORAGE,
  })
  const flags = hizFlags(device, cap)
  buffers.push(uniforms, idle, flags)
  return {
    ...pipelines,
    device,
    // `COPY_SRC` serves only the proof tools, which reread depth; no frame copies.
    level0Usage:
      GPUTextureUsage.RENDER_ATTACHMENT |
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.COPY_SRC,
    pagesGroup: hizPagesGroup(device, pipelines.pagesLayout),
    uniforms,
    stride,
    // Only the words that changed go up: a frame of the same size and rows sends nothing.
    image: new Uint32Array(uniforms.size / 4),
    testOffset: [0],
    idle,
    buffers,
    disposed: false,
    at: undefined,
    bindGroup: undefined,
    bindings: 0,
    bounds: idle,
    state: idle,
    flags,
    cap,
  }
}

/** The Hi-Z's face (`GpuHiz`), over `h`, its first pyramid `first` in place. */
function hizApi(h: HizState, first: Pyramid): GpuHiz {
  const gpu: GpuHiz = {
    width: 0,
    height: 0,
    level0: first.level0,
    level0View: first.level0View,
    flags: h.flags,
    // The whole pyramid, four mips per dispatch (`buildHiz`), in the frame's compute pass.
    encodePyramid(open) {
      const { at, bindGroup } = h
      if (h.disposed || !bindGroup || !at) return
      encodeHizPyramid(open.pass, bindGroup, h.buildPipeline, at.drawn.passes, at.drawn.slots)
    },
    /** Tested boxes and the frame state come from the GPU partition, mounted after us. */
    attach(nextBounds: GPUBuffer, nextState: GPUBuffer) {
      h.bounds = nextBounds
      h.state = nextState
      h.bindings++
      bindHiz(h)
    },
    growFlags: (rows) => hizGrowFlags(h, gpu, rows),
    /** Pyramid mips, with their offset and width: what the partition reads to express a
     *  screen rectangle in texels of the mip that covers it exactly. */
    levels: () => h.at?.drawn.levels ?? [],
    extent: (drawnWidth, drawnHeight) => hizExtent(h, drawnWidth, drawnHeight),
    pyramidBuffer: () => (h.disposed ? undefined : h.at?.pyramid),
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
