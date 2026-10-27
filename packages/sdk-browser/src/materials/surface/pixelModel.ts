import { wgslFn } from '../../../../math/src/wgsl/decl.ts'
import { unorm8Byte } from '../../../../math/src/wgsl/color.ts'
import { GRAPH_SHADING_MODELS } from '../../../../sdk-core/src/world/material/graph/outputs.ts'
import {
  normalCurvatureClamped,
  readShadingSetting,
} from '../../../../sdk-core/src/contracts/shadingOptions.ts'
import { FLAG_LIT } from '../../visibility/types.ts'
import type { VisMaterial } from '../../visibility/materialType.ts'

/**
 * THE SHADING MODEL OF A PIXEL, for the models beside the physical one that a graph picks per pixel
 * (`GRAPH_SHADING_MODELS`): the thin subsurface, the preintegrated skin, the subsurface profile, the hair and the eye. A pixel of one is lit as the
 * physical model in everything the low three bits of its surface flags say (`MODEL_FLAG`): it reflects,
 * is classed and shadowed as one, and a program that knows nothing of the others lights it so. Its
 * model's number travels in the four bits above the first-person mark (`PIXEL_MODEL_SHIFT`), the
 * number the graph's `shadingModel` output gives, 0 for a pixel of none of them; what the model needs
 * beyond the surface's own values is left in the thin transmission's target (`subsurface.ts`) —
 * a skin's colour and opacity, an eye's iris —, and the lighting reads it under that number
 * (`../../lighting/direct/shadingModelWgsl.ts`). A pixel of one of them is of the `single` tile class
 * (`../../lighting/deferred/tileClass.ts`): the programs of the tiles of plain surfaces hold none of it.
 */
export const PIXEL_MODEL_SHIFT = 25
export const PIXEL_MODEL_MASK = 15

/** The models a pixel carries, by the number of the graph's `shadingModel` output. */
export const PIXEL_MODEL = {
  subsurface: GRAPH_SHADING_MODELS.subsurface,
  skin: GRAPH_SHADING_MODELS.preintegratedSkin,
  profile: GRAPH_SHADING_MODELS.subsurfaceProfile,
  hair: GRAPH_SHADING_MODELS.hair,
  eye: GRAPH_SHADING_MODELS.eye,
} as const

/** The models whose pixels the subsurface scattering works over, and whose light the lit image holds apart: the subsurface profile and the
 *  eye. */
export const scattersPixelModel = (model: string) =>
  `(${model}==${PIXEL_MODEL.profile}||${model}==${PIXEL_MODEL.eye})`

/** Whether the shading model number `model` is one a pixel carries (`PIXEL_MODEL`). */
export const isPixelModel = wgslFn(
  'isPixelModel',
  [],
  `fn isPixelModel(model:u32)->bool{return ${Object.values(PIXEL_MODEL)
    .map((id) => `model==${id}u`)
    .join('||')};}`,
)

/** The model number the surface flags `flags` of a pixel carry: 0 for none. */
export const pixelModelOf = wgslFn(
  'pixelModelOf',
  [],
  `fn pixelModelOf(flags:u32)->u32{return (flags>>${PIXEL_MODEL_SHIFT}u)&${PIXEL_MODEL_MASK}u;}`,
)

/** The surface flags' bits of a pixel of model number `model`. */
export const pixelModelFlag = wgslFn(
  'pixelModelFlag',
  [],
  `fn pixelModelFlag(model:u32)->u32{return (model&${PIXEL_MODEL_MASK}u)<<${PIXEL_MODEL_SHIFT}u;}`,
)

/** The item flags `flags` of a pixel of shading model number `number` (`GRAPH_SHADING_MODELS`), the one rule of the record's model and of a
 *  graph's per pixel: the unlit model clears the lit flag (no light, bounce or reflection reaches it), a pixel model leaves its number in
 *  their bits (`pixelModelOf`), any other model leaves the flags. The caller clears the pixel-model bits of a stale number first. */
export const shadingFlagsOfNumber = wgslFn(
  'shadingFlagsOfNumber',
  [isPixelModel, pixelModelFlag],
  `fn shadingFlagsOfNumber(flags:u32,number:u32)->u32{
 if(number==${GRAPH_SHADING_MODELS.unlit}u){return flags&~${FLAG_LIT}u;}
 if(isPixelModel(number)){return flags|pixelModelFlag(number);}
 return flags;
}`,
)

/** Whether a surface may give its pixels one of these models: its graph wires the `shadingModel`
 *  output, whose value is not known before the pixel is shaded, or the material names one (`shadingModel`) — the target that holds what
 *  the models need is made for it. */
export const holdsPixelModels = (
  surface: Pick<VisMaterial, 'graph' | 'shadingModel' | 'modelFromGraph'>,
) =>
  (surface.modelFromGraph !== false && !!surface.graph?.outputs.shadingModel) ||
  (surface.shadingModel !== undefined && surface.shadingModel !== GRAPH_SHADING_MODELS.unlit)

/** Whether a pixel of shading model `shading` (none: the physical one) reflects: neither the hair, whose fibres have no specular lobe
 *  (`surfaceReflects`), nor the unlit model, which no light, bounce or reflection reaches. The CPU's twin of the forward programs' rule
 *  (`blendUnreflecting`, `frontReflects`). */
export const shadingReflects = (shading: number | undefined) =>
  shading !== PIXEL_MODEL.hair && shading !== GRAPH_SHADING_MODELS.unlit

/** The materials' names of the shading models that live in a material's record. */
const SHADING_MODEL_OF_NAME: ReadonlyMap<string | undefined, number> = new Map([
  ['subsurface', PIXEL_MODEL.subsurface],
  ['preintegratedSkin', PIXEL_MODEL.skin],
  ['subsurfaceProfile', PIXEL_MODEL.profile],
  ['eye', PIXEL_MODEL.eye],
  ['hair', PIXEL_MODEL.hair],
  ['unlit', GRAPH_SHADING_MODELS.unlit],
])

/** The number of the shading model a material's name gives (`MaterialShadingModel`) where the material carries it in its record — the
 *  pixel models and the unlit —, none for the others (they are its parameters or its graph's). */
export const shadingModelOfName = (name: string | undefined): number | undefined =>
  SHADING_MODEL_OF_NAME.get(name)

/** A value held to [0, 1] as an 8-bit unsigned normalised channel holds it: its byte (`unorm8Byte`, the library's
 *  rounding) over 255 — how the reference's surface buffer keeps the eye's iris and the clear coat's bottom normal. */
export const quantise8 = wgslFn(
  'quantise8',
  [unorm8Byte],
  'fn quantise8(v:f32)->f32{return f32(unorm8Byte(saturate(v)))/255.0;}',
)
export const quantise8x2 = wgslFn(
  'quantise8x2',
  [quantise8],
  'fn quantise8x2(v:vec2f)->vec2f{return vec2f(quantise8(v.x),quantise8(v.y));}',
)

/** The shading models' switches as the bits the passes read them by: an eye's iris with a normal of its own (`irisNormal`), a clear
 *  coat with a bottom normal (`clearCoatNormal`), the rough diffuse (`shadingRoughDiffuse`), the exact visibility of the specular lobes (`shadingAccurate`), and the two the subsurface scattering sets (`subsurfaceSwitches`): whether it runs
 *  this image, and whether the lit image holds its checkerboard. */
export const MODEL_SWITCH = {
  irisNormal: 1,
  clearCoatNormal: 2,
  subsurfaceScattering: 4,
  subsurfaceCheckerboard: 8,
  roughDiffuse: 16,
  accurate: 32,
} as const
export type ModelSwitch = keyof typeof MODEL_SWITCH

/** The settings' switches of the shading models (`irisNormal`, `clearCoatNormal`, `shadingRoughDiffuse`, `shadingAccurate`), as one word of `MODEL_SWITCH` bits. */
const modelSwitches = (rt: Parameters<typeof readShadingSetting>[0]) =>
  (readShadingSetting(rt, 'irisNormal') ? MODEL_SWITCH.irisNormal : 0) |
  (readShadingSetting(rt, 'clearCoatNormal') ? MODEL_SWITCH.clearCoatNormal : 0) |
  (readShadingSetting(rt, 'shadingRoughDiffuse') ? MODEL_SWITCH.roughDiffuse : 0) |
  (readShadingSetting(rt, 'shadingAccurate') ? MODEL_SWITCH.accurate : 0)

/** Whether the switch `name` is set in the word `switches`, as 1 or 0 (a uniform's value). */
export const switchOn = (switches: number, name: ModelSwitch) =>
  (switches & MODEL_SWITCH[name]) !== 0 ? 1 : 0

/** The words of one image's shading settings (`readShading`): the normal curvature's scale, bias and exponent, then the models'
 *  switches (`modelSwitches`). */
export const SHADING = { curve: 0, switches: 3, length: 4 } as const

/** The shading settings once for the image, into `into` (`SHADING`): the curve a material's `normalCurvatureToRoughness`
 *  takes its roughness by, the settings' scale, bias and exponent held to their ranges (`normalCurvatureClamped`;
 *  `normalCurvatureRoughness`, `../../lighting/ormWgsl.ts`), and the models' switches. The opaque resolve's and the
 *  transparent pass's uniforms copy these words, so they cannot disagree within an image. */
export function readShading(rt: Parameters<typeof readShadingSetting>[0], into: Float64Array) {
  normalCurvatureClamped(
    readShadingSetting(rt, 'normalCurvatureScale'),
    readShadingSetting(rt, 'normalCurvatureBias'),
    readShadingSetting(rt, 'normalCurvatureExponent'),
    into,
    SHADING.curve,
  )
  into[SHADING.switches] = modelSwitches(rt)
}

/** The curve of the shading words `shading` written in a uniform's three words from `at`. */
export function writeNormalCurvature(shading: Float64Array, packed: Float32Array, at: number) {
  for (let i = 0; i < 3; i++) packed[at + i] = shading[SHADING.curve + i]
}

/** Whether any word of `now` differs from the same word of `drawn`. */
export function shadingMoved(drawn: Float64Array, now: Float64Array) {
  for (let i = 0; i < SHADING.length; i++) if (!Object.is(drawn[i], now[i])) return true
  return false
}
/** Keeps the words an image's uniform was written with, which `shadingMoved` compares the next
 *  image's against: every pass that writes them calls it, the opaque resolve's or the blends' alone. */
export function markShadingDrawn(run: { shading: Float64Array; shadingDrawn?: Float64Array }) {
  ;(run.shadingDrawn ??= new Float64Array(SHADING.length)).set(run.shading)
}
