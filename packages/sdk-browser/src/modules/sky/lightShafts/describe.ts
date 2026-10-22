import type { LightShaftLight } from '../../../../../sdk-core/src/modules/sky/lightShafts.ts'
import { LIGHT_SHAFT_BLUR_SAMPLES } from '../../../../../sdk-core/src/modules/sky/lightShafts.ts'
import type { SkyQualityValues } from '../../../../../sdk-core/src/modules/sky/quality.ts'
import {
  computeSamplerEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../../gpu/core/computeBindings.ts'
import { HDR_FORMAT } from '../../../scene/targetFormats.ts'
import type { ImageSize, Size } from '../clouds/reconstructLayout.ts'
import {
  LIGHT_SHAFT_FORMAT,
  LIGHT_SHAFT_MASK_FORMAT,
  lightShaftAspect,
  lightShaftBounds,
  lightShaftDepthTerms,
  lightShaftSizes,
  lightShaftUvPerPixel,
  type LightShaftOrigin,
} from './layout.ts'
import {
  LIGHT_SHAFT_BINDING,
  LIGHT_SHAFT_ENTRY,
  LIGHT_SHAFT_MASK_VIEW,
  LIGHT_SHAFT_VIEW,
  lightShaftProgram,
} from './wgsl.ts'

/**
 * THE LIGHT SHAFTS, described: the passes of the sun's occlusion and bloom, what each binds, writes
 * and draws, and the order a frame runs them in. Nothing here touches the GPU; the pass's owner
 * makes the textures (`layout.ts`), the groups and the draws from the descriptions.
 *
 * For every directional light that asks for one and is in front of the eye, a chain: the reduction
 * of the scene (the occlusion's from the depth, the bloom's from the colour and the depth) into the
 * shafts' image; the image's temporal filter, when the view's anti-aliasing is temporal; the radial
 * blur passes, each reading the one before; then the end — the occlusion's into the mask the fog
 * reads (the one texture every chain writes, the last chain's remaining), the bloom's added onto
 * the lit image. The occlusion runs before the fog, the bloom after the translucent surfaces.
 */

/** The ways a chain starts. */
export type LightShaftTechnique = 'occlusion' | 'bloom'

/** The passes, each a full-screen draw. */
export type LightShaftPass = 'occlusion' | 'bloom' | 'blur' | 'finish' | 'apply'

/** What the temporal filter of the shafts' image is told, the renderer's pass configuration for it:
 *  the history holds colour and opacity, is filtered, takes `1 / lerp` of each new image, is
 *  compared in the luma-chroma space, and its draw is at the reduced resolution of the image
 *  (`resolutionDivisor` is the downsample factor). */
export const LIGHT_SHAFT_TEMPORAL = {
  payload: 'colourOpacity',
  filtered: true,
  lerp: 64,
  lumaChroma: true,
  lowerResolution: true,
} as const

/** The linear, clamped sampler the blur, the end and the apply read the shafts' image through. */
export const LIGHT_SHAFT_SAMPLER: GPUSamplerDescriptor = {
  label: 'Trillion3D light shafts',
  magFilter: 'linear',
  minFilter: 'linear',
  addressModeU: 'clamp-to-edge',
  addressModeV: 'clamp-to-edge',
}

/** `GPUColorWrite`'s flags, written in the clear. */
const RED = 1,
  GREEN = 2,
  BLUE = 4

/** The bloom's blend over the lit image: the shafts' colour added, the image's alpha left as it is. */
export const LIGHT_SHAFT_BLOOM_TARGET: GPUColorTargetState = {
  format: HDR_FORMAT,
  blend: {
    color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
    alpha: { srcFactor: 'zero', dstFactor: 'one', operation: 'add' },
  },
  writeMask: RED | GREEN | BLUE,
}

/** The sizes the passes work at, for a view of `view` pixels in a target allocated at `allocated`. */
export interface LightShaftSizes {
  /** The lit image and the scene's depth: the target's texture, and the part the view fills. */
  readonly scene: ImageSize
  /** The shafts' image, a factor under it. */
  readonly shaft: ImageSize
}

export const lightShaftPassSizes = (
  allocated: Size,
  view: Size,
  downsample: number,
): LightShaftSizes => ({
  scene: { texture: allocated, view },
  shaft: lightShaftSizes(allocated, view, downsample),
})

/** What a pass reads and writes: the image it samples (its texture coordinates are over it) and
 *  the pixels it draws, the lit image's view for the bloom's apply. */
function passImages(pass: LightShaftPass, sizes: LightShaftSizes) {
  switch (pass) {
    case 'occlusion':
    case 'bloom':
      return { input: sizes.scene, written: sizes.shaft.view }
    case 'apply':
      return { input: sizes.shaft, written: sizes.scene.view }
    default:
      return { input: sizes.shaft, written: sizes.shaft.view }
  }
}

/** What a pass draws: a full-screen triangle over the `written` pixels of its target, its one
 *  group and its entries, its target, the uniform and the image its texture coordinates run over. */
export function describeLightShaftPass(pass: LightShaftPass, sizes: LightShaftSizes) {
  const stage = GPUShaderStage.FRAGMENT,
    b = LIGHT_SHAFT_BINDING
  const view = computeUniformEntry(b.view, {}, stage)
  const entries =
    pass === 'occlusion'
      ? [view, computeTextureEntry(b.depth, 'depth', '2d', stage)]
      : pass === 'bloom'
        ? [view, computeTextureEntry(b.source, 'float', '2d', stage)]
        : [
            view,
            computeTextureEntry(b.source, 'float', '2d', stage),
            computeSamplerEntry(b.sampler, 'filtering', stage),
          ]
  const target: GPUColorTargetState =
    pass === 'apply'
      ? LIGHT_SHAFT_BLOOM_TARGET
      : { format: pass === 'finish' ? LIGHT_SHAFT_MASK_FORMAT : LIGHT_SHAFT_FORMAT }
  return {
    code: lightShaftProgram,
    vertexEntry: LIGHT_SHAFT_ENTRY.vertex,
    fragmentEntry: LIGHT_SHAFT_ENTRY[pass],
    entries,
    target,
    ...passImages(pass, sizes),
    uniformFloats: LIGHT_SHAFT_VIEW.words,
    sampler: LIGHT_SHAFT_SAMPLER,
  }
}

/** What the uniform is written from, for every pass of a light's chain. */
export interface LightShaftViewInput {
  readonly light: LightShaftLight
  /** The sky's quality setting `lightShaftFirstPassDistance`. */
  readonly quality: Pick<SkyQualityValues, 'lightShaftFirstPassDistance'>
  readonly sizes: LightShaftSizes
  readonly origin: LightShaftOrigin
  /** The factor the lit image is multiplied by before the bloom reads it, and divided by when the
   *  bloom is added back: the renderer works in the exposed colour. */
  readonly exposure: number
  /** The perspective projection, column-major, the scene's depth was drawn with. */
  readonly projection: ArrayLike<number>
}

/** The uniform (`LIGHT_SHAFT_VIEW`) of `pass` into `out`, `LIGHT_SHAFT_VIEW.words` floats; `index`
 *  is the blur pass's rank, from 0. */
export function writeLightShaftView(
  out: Float32Array,
  input: LightShaftViewInput,
  pass: LightShaftPass,
  index = 0,
) {
  const { light, quality, sizes, origin, exposure } = input
  const { shaft, scene } = sizes
  const at = LIGHT_SHAFT_VIEW.at
  const aspect = lightShaftAspect(shaft)
  const bounds = lightShaftBounds(shaft)
  const { input: read, written } = passImages(pass, sizes)
  const [uvX, uvY] = lightShaftUvPerPixel(read, written)
  const [red, green, blue] = light.shaftBloomTint
  const depth = lightShaftDepthTerms(input.projection)
  out.set(bounds, at.bounds)
  out.set([aspect.x, aspect.y, aspect.inverseX, aspect.inverseY], at.aspect)
  out.set(
    [1 / light.shaftOcclusionDepthRange, light.shaftBloomScale, 1, light.shaftOcclusionDarkness],
    at.light,
  )
  out.set([red, green, blue, light.shaftBloomThreshold], at.tint)
  out.set(
    [
      (origin.pixel[0] / scene.texture.width) * aspect.inverseX,
      (origin.pixel[1] / scene.texture.height) * aspect.inverseY,
      light.shaftBloomMaxBrightness,
      exposure,
    ],
    at.origin,
  )
  out.set([LIGHT_SHAFT_BLUR_SAMPLES, quality.lightShaftFirstPassDistance, index, 0], at.radial)
  out.set([uvX, uvY, 0, 0], at.uv)
  out.set(depth, at.depthTerms)
  out.set(
    [scene.texture.width, scene.texture.height, 1 / scene.texture.width, 1 / scene.texture.height],
    at.scene,
  )
  return out
}

/** A step of a chain. */
export type LightShaftStep =
  | {
      readonly kind: 'pass'
      readonly pass: LightShaftPass
      /** The blur pass's rank, from 0. */
      readonly index: number
    }
  | {
      /** The shafts' image filtered over time (`LIGHT_SHAFT_TEMPORAL`) with the history `history`
       *  names: the occlusion's is the view's, a bloom's is its light's. */
      readonly kind: 'temporal'
      readonly history: 'occlusion' | number
    }

/** One light's chain, in the order its steps run. */
export interface LightShaftChain {
  readonly technique: LightShaftTechnique
  /** The light's rank among the `lights` the plan was made from. */
  readonly light: number
  readonly steps: readonly LightShaftStep[]
}

/** A light as the plan is made from it: a directional light's settings, and where its shafts' light
 *  stands in the view (`lightShaftOrigin`). */
export interface LightShaftLightInput {
  readonly settings: LightShaftLight
  readonly origin: LightShaftOrigin
}

/** What the plan is made from. */
export interface LightShaftPlanInput {
  /** The sky's quality settings: the switch, the reduction, the temporal filter and the blur passes. */
  readonly quality: Pick<
    SkyQualityValues,
    'lightShafts' | 'lightShaftDownsample' | 'lightShaftTemporalFilter' | 'lightShaftBlurPasses'
  >
  /** The target the lit image is allocated at, and the view's pixels. */
  readonly allocated: Size
  readonly view: Size
  /** The directional lights, in the order the renderer meets them. */
  readonly lights: readonly LightShaftLightInput[]
  /** Whether the view's anti-aliasing is temporal and keeps its history. */
  readonly temporal: boolean
}

/**
 * The frame's light shafts: nothing when they are off; else, for each directional light in front of
 * the eye (`origin.w` above 0), an occlusion chain if it occludes, in `occlusion`, and a bloom
 * chain if it blooms, in `bloom`. `maskTarget` is the one texture every occlusion chain ends in
 * (`LIGHT_SHAFT_MASK_FORMAT`), none when no chain runs. Each chain's steps are: the reduction, the
 * temporal filter when it applies, one blur pass per `lightShaftBlurPasses`, then the end.
 */
export function planLightShafts(input: LightShaftPlanInput) {
  const { quality, lights } = input
  const sizes = lightShaftPassSizes(input.allocated, input.view, quality.lightShaftDownsample)
  const occlusion: LightShaftChain[] = [],
    bloom: LightShaftChain[] = []
  if (quality.lightShafts) {
    const chain = (technique: LightShaftTechnique, light: number): LightShaftChain => {
      const steps: LightShaftStep[] = [{ kind: 'pass', pass: technique, index: 0 }]
      if (input.temporal && quality.lightShaftTemporalFilter) {
        steps.push({ kind: 'temporal', history: technique === 'occlusion' ? 'occlusion' : light })
      }
      for (let index = 0; index < quality.lightShaftBlurPasses; index++) {
        steps.push({ kind: 'pass', pass: 'blur', index })
      }
      steps.push({ kind: 'pass', pass: technique === 'occlusion' ? 'finish' : 'apply', index: 0 })
      return { technique, light, steps }
    }
    lights.forEach(({ settings, origin }, light) => {
      if (origin.w <= 0) return
      if (settings.shaftOcclusion) occlusion.push(chain('occlusion', light))
    })
    lights.forEach(({ settings, origin }, light) => {
      if (origin.w <= 0) return
      if (settings.shaftBloom) bloom.push(chain('bloom', light))
    })
  }
  return {
    sizes,
    occlusion,
    bloom,
    maskTarget: occlusion.length ? { format: LIGHT_SHAFT_MASK_FORMAT, size: sizes.shaft } : null,
  }
}

/** What the fog binds to read the mask: the mask's texture (`float`), its sampler (filtering,
 *  clamped: `LIGHT_SHAFT_SAMPLER`) and the uniform (`LIGHT_SHAFT_MASK_VIEW`), at the numbers given. */
export function lightShaftMaskEntries(
  binding: { readonly texture: number; readonly sampler: number; readonly view: number },
  visibility: number,
) {
  return [
    computeTextureEntry(binding.texture, 'float', '2d', visibility),
    computeSamplerEntry(binding.sampler, 'filtering', visibility),
    computeUniformEntry(binding.view, {}, visibility),
  ]
}

/** The fog's uniform (`LIGHT_SHAFT_MASK_VIEW`) into `out`, `LIGHT_SHAFT_MASK_VIEW.words` floats:
 *  the bounds of the mask's view, and the scene's texture size. Where no mask is drawn, the bounds
 *  are the whole texture of `LIGHT_SHAFT_NO_MASK`. */
export function writeLightShaftMaskView(out: Float32Array, sizes: LightShaftSizes, drawn: boolean) {
  const { at } = LIGHT_SHAFT_MASK_VIEW
  const { texture } = sizes.scene
  out.set(drawn ? lightShaftBounds(sizes.shaft) : [0, 0, 1, 1], at.bounds)
  out.set([texture.width, texture.height, 1 / texture.width, 1 / texture.height], at.scene)
  return out
}

/** The texture the fog reads where no mask is drawn: white, so the mask multiplies by 1. */
export const LIGHT_SHAFT_NO_MASK = { format: 'r8unorm', fill: 255 } as const
