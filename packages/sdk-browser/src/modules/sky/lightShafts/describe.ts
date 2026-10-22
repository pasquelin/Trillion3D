import { LIGHT_SHAFT_BLUR_SAMPLES } from '../../../../../sdk-core/src/modules/sky/lightShafts.ts'
import type { LightShaftLight } from '../../../../../sdk-core/src/modules/sky/lightShafts.ts'
import type { SkyQualityValues } from '../../../../../sdk-core/src/modules/sky/quality.ts'
import {
  computeSamplerEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../../gpu/core/computeBindings.ts'
import { depthTermsAhead } from '../../../post/taa/view.ts'
import { HDR_FORMAT } from '../../../scene/targetFormats.ts'
import { put4 } from '../clouds/reconstructLayout.ts'
import {
  LIGHT_SHAFT_FORMAT,
  LIGHT_SHAFT_MASK_FORMAT,
  lightShaftAspect,
  lightShaftBounds,
  lightShaftUvPerPixel,
  type LightShaftOrigin,
  type LightShaftSizes,
} from './layout.ts'
import {
  LIGHT_SHAFT_BINDING,
  LIGHT_SHAFT_ENTRY,
  LIGHT_SHAFT_VIEW,
  lightShaftProgram,
} from './wgsl.ts'

/**
 * THE LIGHT SHAFTS, described: the passes of the sun's occlusion and bloom, what each binds, writes
 * and draws. Nothing here touches the GPU; the pass's owner makes the textures (`layout.ts`), the
 * groups and the draws from the descriptions. The order a frame runs them in is `plan.ts`'s.
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
const LIGHT_SHAFT_BLOOM_TARGET: GPUColorTargetState = {
  format: HDR_FORMAT,
  blend: {
    color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
    alpha: { srcFactor: 'zero', dstFactor: 'one', operation: 'add' },
  },
  writeMask: RED | GREEN | BLUE,
}

/** What each pass is: what its group binds after the uniform (the scene's depth; the scene's
 *  colour and depth; the shafts' image through the sampler), its target, the image its texture coordinates
 *  run over (`reads`) and the image whose pixels it draws (`draws`): the shafts' image, or the lit
 *  image's view for the bloom's apply. */
const PASS = {
  occlusion: {
    binds: 'depth',
    target: { format: LIGHT_SHAFT_FORMAT },
    reads: 'scene',
    draws: 'shaft',
  },
  bloom: {
    binds: 'colourDepth',
    target: { format: LIGHT_SHAFT_FORMAT },
    reads: 'scene',
    draws: 'shaft',
  },
  blur: {
    binds: 'sampled',
    target: { format: LIGHT_SHAFT_FORMAT },
    reads: 'shaft',
    draws: 'shaft',
  },
  finish: {
    binds: 'sampled',
    target: { format: LIGHT_SHAFT_MASK_FORMAT },
    reads: 'shaft',
    draws: 'shaft',
  },
  apply: { binds: 'sampled', target: LIGHT_SHAFT_BLOOM_TARGET, reads: 'shaft', draws: 'scene' },
} as const satisfies Record<LightShaftPass, object>

/** What a pass reads and writes: the image it samples (its texture coordinates are over it) and
 *  the pixels it draws. */
function passImages(pass: LightShaftPass, sizes: LightShaftSizes) {
  const { reads, draws } = PASS[pass]
  return { input: sizes[reads], written: sizes[draws].view }
}

/** The pixels pass `pass` draws: the shafts' image's view, or the lit image's for the bloom's apply. */
export const lightShaftWritten = (pass: LightShaftPass, sizes: LightShaftSizes) =>
  passImages(pass, sizes).written

/** The entries of each pass's group, made on first use (the stage flags are the browser's). */
const entriesOf: Partial<Record<LightShaftPass, GPUBindGroupLayoutEntry[]>> = {}

function passEntries(pass: LightShaftPass) {
  const stage = GPUShaderStage.FRAGMENT,
    b = LIGHT_SHAFT_BINDING
  const { binds } = PASS[pass]
  return (entriesOf[pass] ??= [
    computeUniformEntry(b.view, {}, stage),
    ...(binds === 'depth' ? [] : [computeTextureEntry(b.source, 'float', '2d', stage)]),
    ...(binds === 'depth' || binds === 'colourDepth'
      ? [computeTextureEntry(b.depth, 'depth', '2d', stage)]
      : []),
    ...(binds === 'sampled' ? [computeSamplerEntry(b.sampler, 'filtering', stage)] : []),
  ])
}

/** What a pass draws: a full-screen triangle over the `written` pixels of its target, its one
 *  group and its entries, its target, the uniform and the image its texture coordinates run over. */
export const describeLightShaftPass = (pass: LightShaftPass, sizes: LightShaftSizes) => ({
  code: lightShaftProgram,
  vertexEntry: LIGHT_SHAFT_ENTRY.vertex,
  fragmentEntry: LIGHT_SHAFT_ENTRY[pass],
  entries: passEntries(pass),
  target: PASS[pass].target as GPUColorTargetState,
  ...passImages(pass, sizes),
  uniformFloats: LIGHT_SHAFT_VIEW.words,
  sampler: LIGHT_SHAFT_SAMPLER,
})

/** What the uniform is written from, for every pass of a light's chain. */
export interface LightShaftViewInput {
  readonly light: LightShaftLight
  /** The sky's quality setting `lightShaftFirstPassDistance`. */
  readonly quality: Pick<SkyQualityValues, 'lightShaftFirstPassDistance'>
  readonly sizes: LightShaftSizes
  readonly origin: LightShaftOrigin
  /** The factor the lit image is multiplied by before the bloom reads it, and divided by when the
   *  bloom is added back: the renderer works in the exposed colour. The lit image holds its light
   *  multiplied by its pre-exposure, so the factor is the exposure over it (`PreExposure.shown`);
   *  the bloom added back is in the image's own units. */
  readonly exposure: number
  /** The perspective projection, column-major, the scene's depth was drawn with. */
  readonly projection: ArrayLike<number>
}

/** The uniform (`LIGHT_SHAFT_VIEW`) of `pass` into `out`, `LIGHT_SHAFT_VIEW.words` floats; `index`
 *  is the blur pass's rank, from 0. */
export function writeLightShaftView<T extends Float32Array>(
  out: T,
  input: LightShaftViewInput,
  pass: LightShaftPass,
  index = 0,
) {
  const { light, quality, sizes, origin, exposure } = input
  const { shaft, scene } = sizes
  const at = LIGHT_SHAFT_VIEW.at
  const aspect = lightShaftAspect(shaft)
  const { input: read, written } = passImages(pass, sizes)
  const [uvX, uvY] = lightShaftUvPerPixel(read, written)
  const [red, green, blue] = light.shaftBloomTint
  const [depthA, depthB, depthC, depthD] = depthTermsAhead(input.projection)
  out.set(lightShaftBounds(shaft), at.bounds)
  put4(out, at.aspect, aspect.x, aspect.y, aspect.inverseX, aspect.inverseY)
  put4(
    out,
    at.light,
    1 / light.shaftOcclusionDepthRange,
    light.shaftBloomScale,
    1,
    light.shaftOcclusionDarkness,
  )
  put4(out, at.tint, red, green, blue, light.shaftBloomThreshold)
  put4(
    out,
    at.origin,
    (origin.pixel[0] / scene.texture.width) * aspect.inverseX,
    (origin.pixel[1] / scene.texture.height) * aspect.inverseY,
    light.shaftBloomMaxBrightness,
    exposure,
  )
  put4(out, at.radial, LIGHT_SHAFT_BLUR_SAMPLES, quality.lightShaftFirstPassDistance, index, 0)
  put4(out, at.uv, uvX, uvY, 0, 0)
  put4(out, at.depthTerms, depthA, depthB, depthC, depthD)
  put4(
    out,
    at.scene,
    scene.texture.width,
    scene.texture.height,
    1 / scene.texture.width,
    1 / scene.texture.height,
  )
  return out
}
