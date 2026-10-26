import { arrayView } from '../../../gpu/core/textureViews.ts'
import { HIZ_BUILD_SIDE, hizBuildPasses, hizBuildWords, type HizBuildPass } from './uniforms.ts'
import type { UniformSlots } from '../../../session/memory/pools.ts'
import { pyramidBytes } from './oracle.ts'
import type { HizDepth, HizPyramid } from './types.ts'
import { ceilDiv } from '../../../../../math/src/scalar/integers.ts'
import {
  HIZ_CULL_FARTHEST,
  HIZ_FORMAT,
  hizRoute,
  hizTextureBytes,
  hizTextureSize,
} from './pyramidTexture.ts'
import { hizLevelWords } from './levelsUniform.ts'
import { HIZ_LEVEL0_FORMAT, level0Of } from './level0.ts'
import { texelBytesOf } from '../../../gpu/core/textureBytes.ts'

/** Bytes of one layer of level 0 at `width × height`: an r32float texel a pixel. The front layer,
 *  a scene's whose transparents write a front depth, is one more (`GpuHiz.front`). */
export const level0LayerBytes = (width: number, height: number) =>
  width * height * texelBytesOf(HIZ_LEVEL0_FORMAT)

/** Bytes one view's pyramid holds at `width × height` (`allocPyramid`) without the front layer:
 *  its level 0's opaque depth, and its two slices of packed mips. */
export const pyramidHeldBytes = (width: number, height: number) =>
  level0LayerBytes(width, height) + hizTextureBytes(pyramidBytes(width, height))

/** Source texels one build workgroup covers per side: each thread reduces a 2 × 2 square. */
const TILE = 2 * HIZ_BUILD_SIDE

/**
 * The build passes of the pyramid, as dispatches of the open compute `pass`, by
 * `buildPipeline` — the culling layer's, or the full build's with the trace layers
 * (`HIZ_WITH_TRACE`):
 * consecutive dispatches inside a pass already see each other's writes. Build pass `i` reads
 * uniform slot `i`, bound at `slots[i]` (`UniformSlots.offset`).
 */
export function encodeHizPyramid(
  pass: GPUComputePassEncoder,
  bindGroup: GPUBindGroup,
  buildPipeline: GPUComputePipeline,
  passes: HizBuildPass[],
  slots: number[][],
) {
  pass.setPipeline(buildPipeline)
  for (let i = 0; i < passes.length; i++) {
    pass.setBindGroup(0, bindGroup, slots[i])
    pass.dispatchWorkgroups(ceilDiv(passes[i].width, TILE), ceilDiv(passes[i].height, TILE))
  }
}

/**
 * The build and the test of a pyramid over the `width × height` drawn in its level 0: its passes,
 * their uniform words and offsets in `slots` (`hizUniformSlots`), its mips with their offset and
 * width, and the levels uniform its readers take (`hizLevelWords`), a function of that size alone.
 * The packed mips of a smaller size fit in the texture of a larger one.
 */
export function pyramidLayout(width: number, height: number, slots: UniformSlots) {
  const packed = pyramidBytes(width, height),
    { sizes } = packed,
    passes = hizBuildPasses(sizes),
    cull = packed.offsets.map((offset, level) => hizRoute(offset, level, HIZ_CULL_FARTHEST, packed))
  return {
    width,
    height,
    passes,
    slots: passes.map((_, i) => slots.offset(i)),
    words: hizBuildWords(sizes, cull, passes, slots.stride, packed.upper),
    levelWords: hizLevelWords(sizes, packed.offsets, packed),
  }
}

export type Pyramid = HizPyramid & {
  /** Level 0: the opaque depth the image draws and, in a second layer, the nearest transparent
   *  surface's, each a view of its own, and all in one (`depthView`). */
  level0: GPUTexture
  level0View: GPUTextureView
  depthView: GPUTextureView
  /** The two slices of packed mips (`pyramidTexture.ts`), and their one view: written by the
   *  build as storage, read by the others as a texture. */
  pyramid: GPUTexture
  pyramidView: GPUTextureView
  /** Level 0's front layer, which the transparents' front pass writes (`lighting/reflections/frontLayer.ts`): zero
   *  where no transparent surface lies, whose fold is the opaque depth, bit for bit. */
  frontView: GPUTextureView
  /** Whether this image's fold writes it: the frame word its readers fold it by (`HIZ_FOLD_WGSL`). */
  frontWritten: boolean
  /** Whether its nearest layer keeps the planes' corners (`hizTrace` `'planes'`): the frame word its
   *  build and its readers take (`HIZ_UNI.at.planes`, `HIZ_LEVELS_PLANES_WORD`). */
  planes: boolean
  /** What this image draws in level 0 (`GpuHiz.extent`): the whole size until an image says. */
  drawn: ReturnType<typeof pyramidLayout>
  /** Its bind group (`bindHiz`). */
  group?: GPUBindGroup
  /** What its readers of the whole depth bind (`GpuHiz.depth`), made at the first ask. */
  depth?: HizDepth
}

/** One view's pyramid at `width × height`: its level 0 — with the front layer — and its three
 *  layers of packed mips, its build's uniform words laid in `slots`. */
export function allocPyramid(
  device: GPUDevice,
  usage: number,
  width: number,
  height: number,
  slots: UniformSlots,
): Pyramid {
  const level0 = level0Of(device, usage, width, height)
  // `COPY_DST` and `COPY_SRC` serve only the proof tools, which lay a pyramid of their own and
  // reread it; no frame copies.
  const pyramid = device.createTexture({
    label: 'Trillion3D Hi-Z pyramid',
    size: hizTextureSize(pyramidBytes(width, height)),
    format: HIZ_FORMAT,
    usage:
      GPUTextureUsage.STORAGE_BINDING |
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.COPY_DST |
      GPUTextureUsage.COPY_SRC,
  })
  const made: Pyramid = {
    width,
    height,
    ...level0,
    pyramid,
    pyramidView: arrayView(pyramid),
    drawn: pyramidLayout(width, height, slots),
    frontWritten: false,
    planes: false,
    destroy() {
      made.level0.destroy()
      pyramid.destroy()
    },
  }
  return made
}
