import type { ResponsiveLevel } from '../../../sdk-core/src/contracts/materialAbi.ts'
import type { Side } from '../../../sdk-core/src/contracts/material.ts'
import type { Texture } from '../../../sdk-core/src/texture/contract.ts'
import type { MaterialGraph } from '../../../sdk-core/src/world/material/graph/api.ts'
import type {
  TranslucencyLighting,
  TranslucencyPass,
} from '../../../sdk-core/src/world/constants/index.ts'

/** The anisotropy, clear-coat, cloth and specular maps, in the order their lobe extension names them
 *  (`../materials/table/lobeRecord.ts`). */
export const PHYSICAL_MAP_FIELDS = [
  'anisotropyMap',
  'clearcoatMap',
  'clearcoatRoughnessMap',
  'clearcoatNormalMap',
  'sheenRoughnessMap',
  'sheenColorMap',
  'specularIntensityMap',
] as const
/** The rank in `PHYSICAL_MAP_FIELDS` of the first cloth map (the sheen roughness map, the fuzz colour
 *  map after it, then the specular map): the anisotropy and coat maps, whose slots a record holds in
 *  one vector, precede. */
export const CLOTH_MAP_AT = PHYSICAL_MAP_FIELDS.indexOf('sheenRoughnessMap')
/** The rank in `PHYSICAL_MAP_FIELDS` of the specular map, whose alpha scales the specular. */
export const SPECULAR_MAP_AT = PHYSICAL_MAP_FIELDS.indexOf('specularIntensityMap')
/** The lobe maps that hold a colour, read through the colour atlas (`colorSample`) in sRGB; the
 *  others are data. */
export const PHYSICAL_COLOUR_MAP_FIELDS: ReadonlySet<string> = new Set(['sheenColorMap'])

/** The surface's own maps, in the order their UV channels word names them
 *  (`../materials/table/materialRecord.ts`): `WRAP_MAP`'s ranks (`wrapModes.ts`), the subsurface
 *  map after them. */
export const SURFACE_MAP_FIELDS = [
  'map',
  'roughnessMap',
  'metalnessMap',
  'normalMap',
  'aoMap',
  'emissiveMap',
  'subsurfaceMap',
] as const
/** The subsurface map's rank in a record's UV channels word (`SURFACE_MAP_FIELDS` order, `MAP_CHANNEL_BITS`
 *  bits a map): what both resolves read its coordinate by. */
export const SUBSURFACE_MAP_BIT = SURFACE_MAP_FIELDS.indexOf('subsurfaceMap')

/** A displaced surface's numbers, as its material declares them: the distance the height 1 lies
 *  from the height `center` along the normal, the height that stays on the surface, and the fade
 *  range in pixels — the on-screen size of the largest displacement at which it starts to fade and
 *  at which it is gone — or `null` for a displacement that never fades, and the density of its
 *  texture coordinates. */
export type SurfaceDisplacement = {
  readonly magnitude: number
  readonly center: number
  readonly fade: { readonly start: number; readonly end: number } | null
  /** The units of the object's space one unit of each of its eight texture-coordinate sets
   *  covers (`DisplacementWire`): the micro-triangles' map level follows it. 0 or absent reads 1. */
  readonly uvDensities?: readonly number[]
}

export type VisMaterial = {
  baseColor: [number, number, number]
  metalness: number
  roughness: number
  lit: boolean
  /** False keeps this material's colour outside the scene's fog. */
  fog?: boolean
  /** True lets the clouds in front of a blended surface be laid over its fog (it needs the fog: `fog` not false). */
  cloudFog?: boolean
  /** True works the fog of a blended surface out for each pixel; else for each vertex, interpolated (`../blend/cloudVertexText.ts`). */
  computeFogPerPixel?: boolean
  /** True lets the lights cast contact shadows on a blended surface: a short ray from each pixel toward each light through the
   *  opaque scene's depth (`../lighting/contactShadow/contactShadowWgsl.ts`); the programs read that depth only for a scene
   *  that holds such a surface (`../materials/surface/blendLightSource.ts`, `contactShadowsOf`). */
  contactShadows?: boolean
  /** How a blended surface reads the shadow of the lights that reach it, beyond the project's switches
   *  (`../materials/surface/surfaceModel.ts`, `TRANSLUCENT_SHADOW_MODEL_SHIFT`): whether a local
   *  light's shadow reaches it, and, from 0 to 1, whether the local lights' and the sun's are traced
   *  (above 0) or sampled once. */
  translucentLocalLightShadow?: boolean
  translucentLocalLightShadowQuality?: number
  translucentDirectionalLightShadowQuality?: number
  /** How a blended surface is lit (`../materials/surface/surfaceModel.ts`, `TRANSLUCENCY_LIGHTING_CODE`):
   *  each light read for the pixel (`'forward'`), or, in a translucent or additive layer, from the translucency lighting volume
   *  as a surface, a medium or a medium with no direction (the default, `DEFAULT_TRANSLUCENCY_LIGHTING`, a medium with no direction). */
  translucencyLighting?: TranslucencyLighting
  /** The pass of the image a blended surface is drawn in (`../blend/translucencyPhase.ts`): after the
   *  depth of field by default. */
  translucencyPass?: TranslucencyPass
  /** Whether its graph's emission is left as it is computed, not held at zero
   *  (`../materials/graph/outputsOf.ts`). */
  allowNegativeEmissive?: boolean
  /** What the `opacityMask` output of its graph must reach to be drawn (`maskClipValueOf`), and whether
   *  it cuts by a dither of the output (`../materials/graph/maskProgram.ts`). */
  opacityMaskClipValue?: number
  ditherOpacityMask?: boolean
  /** Whether a two-sided surface is drawn as its back then its face (`../blend/statics.ts`, `asksTwoPasses`). */
  twoSidedPasses?: boolean
  /** Whether the roughness is at least the one the screen-space change of its vertex normal gives it
   *  (`../materials/surface/surfaceModel.ts`, `NORMAL_CURVATURE_MODEL_BIT`). */
  normalCurvatureToRoughness?: boolean
  /** What its graph's `worldPositionOffset` output asks of the offset it moves its vertices by
   *  (`../materials/graph/wpoProgram.ts`): the most it may move a vertex (metres, 0 holds nothing and
   *  grows no bound) and whether it is evaluated whatever its object says (`Object3D.evaluateWorldPositionOffset`,
   *  `worldPositionOffsetDisableDistance`, `worldPositionOffsetWritesVelocity`). */
  maxWorldPositionOffset?: number
  alwaysEvaluateWorldPositionOffset?: boolean
  /** How far the temporal anti-aliasing trusts the history on its pixels (`RESPONSIVE_SHIFT`);
   *  `'off'`, or none, the normal accumulation. */
  responsive?: ResponsiveLevel
  /** True for the material of a sky dome mesh (`SurfaceDeclaration.sky`): shown unlit, as its base colour
   *  alone. */
  sky?: boolean
  /** Which faces it draws: the pipelines' culling, the row's face flags, the cut's cones. */
  side: Side
  alphaTest: number
  map?: Texture
  metalnessMap?: Texture
  roughnessMap?: Texture
  normalMap?: Texture
  normalScale: number
  normalScaleY: number
  /** `normalScaleY` in a frame read from vertex tangents, not rebuilt (`frameNormal.ts`). */
  tangentNormalScaleY?: number
  aoMap?: Texture
  aoIntensity: number
  emissive: [number, number, number]
  subsurfaceColor?: [number, number, number]
  /** The opacity of its subsurface, 0 to 1, one where unsaid (`SUBSURFACE_OPACITY_MODEL_SHIFT`). */
  subsurfaceOpacity?: number
  /** The row of the subsurface profile table its pixels of the subsurface-profile and eye models scatter with, 0 to 255, the default skin's
   *  where unsaid (`SUBSURFACE_PROFILE_MODEL_SHIFT`); on a toon material the row of its toon profile, the default profile's where unsaid. */
  subsurfaceProfile?: number
  /** The number of the shading model its pixels take without a graph (`PIXEL_MODEL`), none where unsaid. */
  shadingModel?: number
  /** An eye's distance of the iris, 0 to 1, 0.1 where unsaid (the eye model without a graph). */
  irisDistance?: number
  /** Whether its graph's `shadingModel` output decides its pixels' model (the material says `fromMaterialExpression`); unsaid, it does. */
  modelFromGraph?: boolean
  subsurfaceMap?: Texture
  emissiveMap?: Texture
  /** `KHR_materials_transmission.transmissionFactor`: the share of the background the surface lets through. */
  anisotropy?: number
  anisotropyRotation?: number
  anisotropyMap?: Texture
  clearcoatMap?: Texture
  clearcoatRoughnessMap?: Texture
  clearcoatNormalMap?: Texture
  clearcoatNormalScale?: readonly [number, number]
  /** The cloth lobe (`../materials/surface/physicalLobes.ts`): 1 where the surface wears the cloth
   *  shading model, its fuzz colour, the cloth amount (the sheen roughness) and their maps. */
  sheen?: number
  sheenColor?: [number, number, number]
  sheenRoughness?: number
  sheenColorMap?: Texture
  sheenRoughnessMap?: Texture
  /** The specular input of a dielectric (`KHR_materials_specular`): its reflectance at normal
   *  incidence is 0.08 of it (`surfaceF0`), 0.5 where a surface declares none. Its map's alpha scales
   *  it. Declared, it is read from the record whatever else the surface wears. */
  specularIntensity?: number
  specularIntensityMap?: Texture
  /** The height map of a displaced surface and its numbers (`SurfaceDisplacement`): what the
   *  tessellation reads (`../visibility/tessellation/`); absent on a surface drawn flat. */
  displacementMap?: Texture
  displacement?: SurfaceDisplacement
  clearcoat?: number
  clearcoatRoughness?: number
  transmission: number
  /** `KHR_materials_ior.ior`, and the volume of `KHR_materials_volume`. `attenuationDistance` is 0
   *  when the glTF does not declare one: the volume then attenuates nothing. */
  ior: number
  /** Whether the surface declares its ior (`KHR_materials_ior`, or the host's own field): only
   *  then does it refract: the default ior serves Fresnel, never a bend nobody asked for. */
  refracts?: boolean
  thickness: number
  attenuationDistance: number
  attenuationColor: [number, number, number]
  /** The material multiplies its base colour by the geometry's `color` attribute, when it has one. */
  vertexColors?: boolean
  /** The graph that computes the surface's outputs in place of its parameters and maps
   *  (`../materials/graph/surfaceProgram.ts`); absent on a surface drawn from its parameters. */
  graph?: MaterialGraph
  /** Whether the surface is single-layer water: lit, its graph wires a water output
   *  (`isWaterGraph`). The transparent pass draws it as the water pass (`../blend/water/`). */
  water?: boolean
  /** The surface model a non-physical family maps onto (`../materials/surface/surfaceModel.ts`); physical if absent. */
  model?: number
  /** Width in CSS pixels the rasters widen a line quad to (`shader/lineWgsl.ts`); absent or
   *  zero on a surface that draws triangles. */
  lineWidth?: number
  /** A dashed line's dash and gap along the line, in world units (`shader/lineWgsl.ts`,
   *  `lineDash`); absent on any other surface. */
  dashSize?: number
  gapSize?: number
  /** A sprite's quad, which every raster turns to face the camera (`shader/spriteWgsl.ts`): its
   *  turn in the image in radians, and whether it shrinks with distance; absent on any other
   *  surface. */
  sprite?: { rotation: number; sizeAttenuation: boolean }
}
