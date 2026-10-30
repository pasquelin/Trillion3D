import type { Material } from './material.ts'
import { clamp } from '../../../../math/src/scalar/reals.ts'

/** The kind name of a material of the post-process domain (`material.postProcess`). */
export const POST_PROCESS_MATERIAL_KIND = 'postProcess'

/**
 * THE POST-PROCESS DOMAIN is a domain of the engine's one material system (`material.ts`): a material
 * made as `material.postProcess` is a graph evaluated at every pixel of the image by a full-screen
 * pass, its `emissive` output the colour the pixel takes and, where `blendableOutputAlpha` is on, its
 * `opacity` output the alpha. Its texture coordinates are the pixel's place in the image, 0 to 1
 * (`texCoord`), and its scene texture nodes (`sceneTexture`) read the image so far, the depth, the
 * custom depth and stencil. It joins the image as a blendable (`EffectChain.blendables`), at the
 * `blendableLocation` it names, in the order of its `blendablePriority`.
 */

/** Where a post-process material joins the image, in the order the image is made: ahead of the depth of
 *  field, after it, on the translucency drawn after it, on the history the reflections keep (`ssrInput`),
 *  after the temporal pass and the motion blur and before the bloom, in the place of the tone mapper, or
 *  over the tone-mapped image. */
export const BLENDABLE_LOCATIONS = [
  'sceneColorBeforeDof',
  'sceneColorAfterDof',
  'translucencyAfterDof',
  'ssrInput',
  'sceneColorBeforeBloom',
  'replacingTonemapper',
  'sceneColorAfterTonemapping',
] as const
/** A place a post-process material joins the image. */
export type BlendableLocation = (typeof BLENDABLE_LOCATIONS)[number]

/** The places the image does not offer yet: a material that names one validates but is never drawn, and the frame says so by name. */
export const UNDRAWN_LOCATIONS: readonly BlendableLocation[] = [
  'translucencyAfterDof',
  'ssrInput',
  'replacingTonemapper',
]

/** The comparisons of the stencil test of a post-process material: the pixel is kept where the reference
 *  value, compared to the pixel's custom stencil, satisfies it. */
export const STENCIL_COMPARES = [
  'less',
  'lessEqual',
  'greater',
  'greaterEqual',
  'equal',
  'notEqual',
  'never',
  'always',
] as const
/** A stencil comparison. */
export type StencilCompare = (typeof STENCIL_COMPARES)[number]

/** The images a scene texture node reads, by the name a graph gives them. */
export const SCENE_TEXTURE_IDS = [
  'sceneColor',
  'sceneDepth',
  'customDepth',
  'customStencil',
  'postProcessInput0',
] as const
/** The name of a scene texture. */
export type SceneTextureId = (typeof SCENE_TEXTURE_IDS)[number]

/** Whether `value` is the name of a scene texture. */
export const isSceneTextureId = (value: unknown): value is SceneTextureId =>
  (SCENE_TEXTURE_IDS as readonly unknown[]).includes(value)

/** The values a post-process material starts from. */
export const POST_PROCESS_DEFAULTS = {
  blendableLocation: 'sceneColorAfterTonemapping' as BlendableLocation,
  blendablePriority: 0,
  blendableOutputAlpha: false,
  isBlendable: true,
  disablePreExposureScale: false,
  enableStencilTest: false,
  stencilCompare: 'less' as StencilCompare,
  stencilRefValue: 0,
}

/** Whether `material` is of the post-process domain. */
export const isPostProcessMaterial = (material: Material) =>
  material.kind === POST_PROCESS_MATERIAL_KIND

/** What a post-process material says of how it joins the image, each field held to what it takes. */
export interface PostProcessBlendable {
  readonly location: BlendableLocation
  readonly priority: number
  readonly outputAlpha: boolean
  readonly isBlendable: boolean
  readonly disablePreExposureScale: boolean
  readonly stencilTest: boolean
  readonly stencilCompare: StencilCompare
  readonly stencilRef: number
}

const oneOf = <T extends string>(list: readonly T[], value: unknown, fallback: T): T =>
  (list as readonly unknown[]).includes(value) ? (value as T) : fallback

/** The blendable properties of `material`, the defaults where it names none or a value they do not take. */
export function blendableOf(material: Material): PostProcessBlendable {
  const d = POST_PROCESS_DEFAULTS
  const priority = material.blendablePriority
  const ref = material.stencilRefValue
  return {
    location: oneOf(BLENDABLE_LOCATIONS, material.blendableLocation, d.blendableLocation),
    priority: Number.isInteger(priority) ? (priority as number) : d.blendablePriority,
    outputAlpha: material.blendableOutputAlpha === true,
    isBlendable: material.isBlendable !== false,
    disablePreExposureScale: material.disablePreExposureScale === true,
    stencilTest: material.enableStencilTest === true,
    stencilCompare: oneOf(STENCIL_COMPARES, material.stencilCompare, d.stencilCompare),
    stencilRef: typeof ref === 'number' && Number.isInteger(ref) ? clamp(ref, 0, 255) : 0,
  }
}
