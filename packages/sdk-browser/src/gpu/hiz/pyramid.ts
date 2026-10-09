import { HIZ_BUILD_SIDE, hizBuildPasses, hizBuildWords, type HizBuildPass } from './uniforms.ts'
import type { UniformSlots } from '../../residency/pools.ts'
import { pyramidBytes } from './oracle.ts'
import type { HizDepth, HizPyramid } from './types.ts'
import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { HIZ_FORMAT, hizLevelWords, hizTextureBytes, hizTextureSize } from './pyramidTexture.ts'

/** The label of a pyramid's level 0, the one texture it holds. */
const HIZ_LEVEL0_LABEL = 'Trillion3D Hi-Z level 0'
/** Bytes one view's pyramid holds at `width × height` (`allocPyramid`): its level 0, one r32float
 *  texel a pixel, and its three layers of packed mips. */
export const pyramidHeldBytes = (width: number, height: number) =>
  width * height * 4 + hizTextureBytes(pyramidBytes(width, height).texels)

/** Source texels one build workgroup covers per side: each thread reduces a 2 × 2 square. */
const TILE = 2 * HIZ_BUILD_SIDE

/**
 * The build passes of `count` pyramids, one per `z`, as dispatches of the open compute `pass`, by
 * `buildPipeline` — the culling layer's, or the nearest's with the finished depth's farthest
 * (`HIZ_NEAREST_BUILD`):
 * consecutive dispatches inside a pass already see each other's writes. Build pass `i` reads
 * uniform slot `i`, bound at `slots[i]` (`UniformSlots.offset`).
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
 * their uniform words and offsets in `slots` (`hizUniformSlots`), its mips with their offset and
 * width, and the levels uniform its readers take (`hizLevelWords`), a function of that size alone.
 * The packed mips of a smaller size fit in the texture of a larger one.
 */
export function pyramidLayout(width: number, height: number, slots: UniformSlots) {
  const { sizes, offsets } = pyramidBytes(width, height),
    passes = hizBuildPasses(sizes)
  return {
    width,
    height,
    passes,
    slots: passes.map((_, i) => slots.offset(i)),
    words: hizBuildWords(sizes, offsets, passes, slots.stride),
    levels: sizes.map((size, level) => ({ offset: offsets[level], width: size[0] })),
    levelWords: hizLevelWords(sizes, offsets),
  }
}

export type Pyramid = HizPyramid & {
  level0: GPUTexture
  level0View: GPUTextureView
  /** The three layers of packed mips (`pyramidTexture.ts`), and their one view: written by the
   *  build as storage, read by the others as a texture. */
  pyramid: GPUTexture
  pyramidView: GPUTextureView
  /** What this image draws in level 0 (`GpuHiz.extent`): the whole size until an image says. */
  drawn: ReturnType<typeof pyramidLayout>
  /** Its bind group, and the `attach` generation it was made for. */
  group?: GPUBindGroup
  bindings?: number
  /** What its readers of the whole depth bind (`GpuHiz.depth`), made at the first ask. */
  depth?: HizDepth
}

/** One view's pyramid at `width × height`: its level 0 and its three layers of packed mips, its
 *  build's uniform words laid in `slots`. */
export function allocPyramid(
  device: GPUDevice,
  usage: number,
  width: number,
  height: number,
  slots: UniformSlots,
): Pyramid {
  const level0 = device.createTexture({
    label: HIZ_LEVEL0_LABEL,
    size: { width, height },
    format: 'r32float',
    usage,
  })
  // `COPY_DST` and `COPY_SRC` serve only the proof tools, which lay a pyramid of their own and
  // reread it; no frame copies.
  const pyramid = device.createTexture({
    label: 'Trillion3D Hi-Z pyramid',
    size: hizTextureSize(pyramidBytes(width, height).texels),
    format: HIZ_FORMAT,
    usage:
      GPUTextureUsage.STORAGE_BINDING |
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.COPY_DST |
      GPUTextureUsage.COPY_SRC,
  })
  return {
    width,
    height,
    level0,
    level0View: level0.createView(),
    pyramid,
    pyramidView: pyramid.createView({ dimension: '2d-array' }),
    drawn: pyramidLayout(width, height, slots),
    destroy() {
      level0.destroy()
      pyramid.destroy()
    },
  }
}
