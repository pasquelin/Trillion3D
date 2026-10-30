/**
 * THE RECORD'S MODEL WORD AND THE MODEL LANE: where each field of a surface's model sits, the flags of the models (`SURFACE_MODEL`,
 * `MODEL_FLAG`) and the lane accessors every pass reads them by. The families' rules and the formulas of the models are in
 * `./surfaceModel.ts`, the lighting modes' in `./translucencyLighting.ts`, the shading models' codes in `./shadingModelCode.ts`.
 */
import { wgslFn } from '../../../../math/src/wgsl/decl.ts'
import { clamp } from '../../../../math/src/scalar/reals.ts'

export const SURFACE_MODEL = {
  standard: 0,
  diffuse: 1,
  // Rank 2 is free.
  normal: 3,
  matcap: 4,
  depth: 5,
  shadow: 6,
  // Rank 7 is reserved: the record's lane holds `LIGHTLESS_MODEL` there, never a surface or a row.
} as const
/** Bits of the page row's flags word that carry the model; below them, the material flags. */
export const MODEL_SHIFT = 17
/** Surface-buffer flags of the lit models: the physical one, the only one with a specular lobe (a
 *  reflection is traced for it alone), the diffuse one the resolve shades apart, and the shadow catcher,
 *  which only a blend fragment reads: it is always blended (`../../geometry/pages/surfaceRecord.ts`). */
export const MODEL_FLAG = { physical: 2, diffuse: 4, shadow: 6 } as const
/** Surface-buffer flag of a debug view, a normal or depth surface: shown as-is, never fogged,
 *  and composed with neither exposure nor the display curve (`shownAsIs`). */
export const AS_IS_FLAG = 3
/** Surface-buffer flag of an unlit surface: its colour is shown as it is, fogged, and no light
 *  reaches it. */
export const UNLIT_FLAG = 1
/** Low three G-buffer bits identify the surface model; higher bits are independent marks. */
export const SURFACE_MODEL_MASK = 7
/** The surface-buffer flag of a lit surface whose row or item flags `flags` carry its model lane
 *  (`MODEL_SHIFT`): the physical one, the diffuse or the shadow catcher's, as the lane
 *  says. The one mapping of the opaque shade, the blend fragment and the front stage. */
export const modelFlag = wgslFn(
  'modelFlag',
  [],
  `fn modelFlag(flags:u32)->u32{
 let model=(flags>>${MODEL_SHIFT}u)&7u;
 if(model==${SURFACE_MODEL.diffuse}u){return ${MODEL_FLAG.diffuse}u;}
 if(model==${SURFACE_MODEL.shadow}u){return ${MODEL_FLAG.shadow}u;}
 return ${MODEL_FLAG.physical}u;
}`,
)
/** The fields of the record's model word, each from its shift for its bits: the forward item's lane
 *  (the model, a fog opt-out and the clouds laid over the fog), the dithered cutout, how a blended
 *  surface reads the lights' shadow, how it is lit, a thin subsurface's opacity and the subsurface profile. No two overlap
 *  (checked as the module loads). */
const MODEL_WORD = {
  lane: { shift: 0, bits: 5 },
  dither: { shift: 5, bits: 1 },
  translucentShadow: { shift: 6, bits: 3 },
  translucencyLighting: { shift: 9, bits: 2 },
  normalCurvature: { shift: 11, bits: 1 },
  subsurfaceOpacity: { shift: 12, bits: 8 },
  subsurfaceProfile: { shift: 20, bits: 8 },
  shadingModel: { shift: 29, bits: 3 },
  masked: { shift: 28, bits: 1 },
} as const
let modelWordTaken = 0
for (const { shift, bits } of Object.values(MODEL_WORD)) {
  const field = ((1 << bits) - 1) << shift
  if (modelWordTaken & field) throw new Error('SURFACE_MODEL: two fields of the model word overlap')
  modelWordTaken |= field
}
/** The record's model word holds, last, that the surface's alpha mode is `mask` (`alphaModeOf`): what a
 *  transmissive glTF material is shaped by (`blend/transmission/transmitWgsl.ts`). */
export const MASKED_MODEL_BIT = 1 << MODEL_WORD.masked.shift
/** The forward item's model lane holds, after the three model bits, a material's fog opt-out... */
export const FOG_FREE_MODEL_BIT = 8
/** ...and, above it, that the clouds in front of its fogged, blended surface are laid over its fog
 *  (`VisMaterial.cloudFog`): the fragment reads it at bit `MODEL_SHIFT + 4` of its flags. */
export const CLOUD_FOG_MODEL_BIT = 16
/** The fog opt-out's bit in a forward item's flags (the model lane sits at `MODEL_SHIFT`). */
const FOG_FREE_FLAG = FOG_FREE_MODEL_BIT << MODEL_SHIFT
/** The WGSL condition that the material of `flags` (a WGSL expression) takes no fog. */
export const fogFreeFlag = (flags: string) => `(${flags}&${FOG_FREE_FLAG}u)!=0u`
/** The WGSL conditions that the record's model word `model` (a WGSL expression) opts out of the fog, and that
 *  it lays the clouds over the fog. */
export const fogFreeModel = (model: string) => `(${model}&${FOG_FREE_MODEL_BIT}u)!=0u`
export const cloudFogModel = (model: string) => `(${model}&${CLOUD_FOG_MODEL_BIT}u)!=0u`
/** The record's model word holds, above the lane the forward item carries (`MODEL_LANE_BITS`), that
 *  the surface's cutout is dithered (`VisMaterial.ditherOpacityMask`): read by the rasters that cut
 *  (`maskKeepAt`), never carried into an item's flags. */
export const DITHER_MODEL_BIT = 1 << MODEL_WORD.dither.shift
/** The bits of the record's model word the forward item's lane carries: the model, the fog opt-out
 *  and the clouds laid over the fog. */
export const MODEL_LANE_BITS = SURFACE_MODEL_MASK | FOG_FREE_MODEL_BIT | CLOUD_FOG_MODEL_BIT
if (MODEL_LANE_BITS !== (1 << MODEL_WORD.lane.bits) - 1)
  throw new Error('SURFACE_MODEL: the lane bits are not the lane field')
/** The record's model word holds, from here, three more bits, how a blended surface reads the
 *  shadow of the lights that reach it, beyond the project's switches: bit 0, a local light's shadow
 *  reaches it (`VisMaterial.translucentLocalLightShadow`); bit 1, the local lights' shadow is traced,
 *  not sampled once (`translucentLocalLightShadowQuality` above 0); bit 2, the sun's is
 *  (`translucentDirectionalLightShadowQuality` above 0). The blend vertex stage carries them to the
 *  item's flags, from `TRANSLUCENT_SHADOW_FLAG_SHIFT`, where its fragments read them
 *  (`translucentShadowBits`, `../../lighting/direct/shadowWgsl.ts`). */
export const TRANSLUCENT_SHADOW_MODEL_SHIFT = MODEL_WORD.translucentShadow.shift
export const TRANSLUCENT_SHADOW_FLAG_SHIFT = 22
/** The marks, as the bits of that three-bit group. */
export const TRANSLUCENT_SHADOW_MARK = { local: 1, localTrace: 2, directionalTrace: 4 } as const

/** The record's model word holds, from here, two more bits: how a blended surface is lit
 *  (`TRANSLUCENCY_LIGHTING_CODE`). The blend vertex stage carries them to the item's flags, their low
 *  bit at `TRANSLUCENCY_LIGHTING_FLAG_LOW` and the high one at `TRANSLUCENCY_LIGHTING_FLAG_HIGH` (two
 *  bits of the blend item's flags word that no item flag — a row's flags above the sixteenth never reach it,
 *  `ITEM_FLAG_BITS` —, no model lane, shadow mark or frame flag holds), where its fragments read them
 *  (`translucencyLightingOf`, `../../lighting/translucency/readWgsl.ts`). */
export const TRANSLUCENCY_LIGHTING_MODEL_SHIFT = MODEL_WORD.translucencyLighting.shift
export const TRANSLUCENCY_LIGHTING_FLAG_LOW = 16
export const TRANSLUCENCY_LIGHTING_FLAG_HIGH = 29

/** The record's model word holds, at one bit, that the material reduces its roughness by the screen-space
 *  change of its vertex normal (`VisMaterial.normalCurvatureToRoughness`, off by default). The blend vertex
 *  stage carries it to the item's flags, bit 31 (`NORMAL_CURVATURE_FLAG_MASK`, `normalCurvatureFlag`); the
 *  opaque resolve reads it from the record (`normalCurvatureOfModel`). */
export const NORMAL_CURVATURE_MODEL_BIT = 1 << MODEL_WORD.normalCurvature.shift
export const NORMAL_CURVATURE_FLAG_MASK = 0x80000000
export const normalCurvatureOfModel = (model: string) =>
  `((${model}&${NORMAL_CURVATURE_MODEL_BIT}u)!=0u)`
/** The item flag a record's model word gives its blended surface: `NORMAL_CURVATURE_FLAG_MASK` where the material asks for the curvature. */
export const normalCurvatureFlag = wgslFn(
  'normalCurvatureFlag',
  [],
  `fn normalCurvatureFlag(model:u32)->u32{return select(0u,${NORMAL_CURVATURE_FLAG_MASK}u,${normalCurvatureOfModel('model')});}`,
)

/** The record's model word holds, from here, eight bits more: the opacity of a thin surface's subsurface
 *  (`VisMaterial.subsurfaceOpacity`), a byte, which the opaque resolve leaves in the alpha of the thin
 *  transmission's target (`subsurface.ts`) under the subsurface flag, as the shadows read it
 *  (`vsmTransmitsShadow`). */
export const SUBSURFACE_OPACITY_MODEL_SHIFT = MODEL_WORD.subsurfaceOpacity.shift
/** The byte of an opacity in [0, 1]. */
export const subsurfaceOpacityCode = (opacity: number) => Math.round(clamp(opacity, 0, 1) * 255)
/** The opacity a record's model word holds. */
export const subsurfaceOpacityOfModel = wgslFn(
  'subsurfaceOpacityOfModel',
  [],
  `fn subsurfaceOpacityOfModel(model:u32)->f32{return f32((model>>${SUBSURFACE_OPACITY_MODEL_SHIFT}u)&255u)/255.0;}`,
)

/** The record's model word holds, from here, eight bits more: the number of the material's subsurface profile
 *  (`VisMaterial.subsurfaceProfile`, the row of the profile table, 0 the default skin's), which the surface pass leaves in the data of a
 *  pixel of the subsurface-profile and eye models (`../../lighting/subsurface/litHook.ts`); on a toon material the row of its toon profile
 *  (`../../lighting/toon/registry.ts`, 0 the default profile), left in the data of its pixels. */
export const SUBSURFACE_PROFILE_MODEL_SHIFT = MODEL_WORD.subsurfaceProfile.shift
export const subsurfaceProfileOfModel = wgslFn(
  'subsurfaceProfileOfModel',
  [],
  `fn subsurfaceProfileOfModel(model:u32)->f32{return f32((model>>${SUBSURFACE_PROFILE_MODEL_SHIFT}u)&255u);}`,
)

/** The record's model word holds, from here, three bits more: the code of the shading model the material gives its pixels without a graph
 *  (`VisMaterial.shadingModel`, the model's number): 1 the preintegrated skin, 2 the subsurface profile, 3 the eye, 4 the hair, 5 the
 *  unlit, 6 the thin subsurface, 7 the toon, 0 none. */
export const SHADING_MODEL_MODEL_SHIFT = MODEL_WORD.shadingModel.shift
