import {
  HIZ_BUILD_SIDE,
  hizBuildPasses,
  hizBuildSlots,
  hizBuildWords,
  type HizBuildPass,
} from './uniforms.ts'
import { pyramidBytes } from './oracle.ts'
import type { HizPyramid } from './types.ts'
import { ceilDiv } from '../../../../math/src/scalar/integers.ts'

/** The label of a pyramid's level 0, the one texture it holds. */
const HIZ_LEVEL0_LABEL = 'Trillion3D Hi-Z level 0'
/** Bytes one view's pyramid holds at `width × height` (`allocPyramid`): its level 0, one r32float
 *  texel a pixel, and its packed mips. */
export const pyramidHeldBytes = (width: number, height: number) =>
  width * height * 4 + pyramidBytes(width, height).bytes

/** Source texels one build workgroup covers per side: each thread reduces a 2 × 2 square. */
const TILE = 2 * HIZ_BUILD_SIDE

/**
 * The build passes of `count` pyramids, one per `z`, as dispatches of the open compute `pass`:
 * consecutive dispatches inside a pass already see each other's writes. Build pass `i` reads
 * uniform slot `i`, bound at `slots[i]` (`hizBuildSlots`).
 */
export function encodeHizPyramid(
  pass: GPUComputePassEncoder,
  bindGroup: GPUBindGroup,
  buildPipeline: GPUComputePipeline,
  passes: HizBuildPass[],
  slots: number[][],
  count = 1,
) {
  pass.setPipeline(buildPipeline)
  for (let i = 0; i < passes.length; i++) {
    pass.setBindGroup(0, bindGroup, slots[i])
    pass.dispatchWorkgroups(ceilDiv(passes[i].width, TILE), ceilDiv(passes[i].height, TILE), count)
  }
}

/**
 * The build and the test of a pyramid over the `width × height` drawn in its level 0: its passes,
 * their uniform words and its mips with their offset and width, a function of that size alone.
 * The packed mips of a smaller size fit in the buffer of a larger one.
 */
export function pyramidLayout(width: number, height: number) {
  const { sizes, offsets } = pyramidBytes(width, height),
    passes = hizBuildPasses(sizes)
  return {
    width,
    height,
    passes,
    slots: hizBuildSlots(passes),
    words: hizBuildWords(sizes, offsets, passes),
    levels: sizes.map((size, level) => ({ offset: offsets[level], width: size[0] })),
  }
}

export type Pyramid = HizPyramid & {
  level0: GPUTexture
  level0View: GPUTextureView
  pyramid: GPUBuffer
  /** What this image draws in level 0 (`GpuHiz.extent`): the whole size until an image says. */
  drawn: ReturnType<typeof pyramidLayout>
  /** Its bind group, and the `attach` generation it was made for. */
  group?: GPUBindGroup
  bindings?: number
}

/** One view's pyramid at `width × height`: its level 0 and its packed mips. */
export function allocPyramid(
  device: GPUDevice,
  usage: number,
  width: number,
  height: number,
): Pyramid {
  const level0 = device.createTexture({
    label: HIZ_LEVEL0_LABEL,
    size: { width, height },
    format: 'r32float',
    usage,
  })
  const pyramid = device.createBuffer({
    label: 'Trillion3D Hi-Z pyramid',
    size: pyramidBytes(width, height).bytes,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  return {
    width,
    height,
    level0,
    level0View: level0.createView(),
    pyramid,
    drawn: pyramidLayout(width, height),
    destroy() {
      level0.destroy()
      pyramid.destroy()
    },
  }
}
