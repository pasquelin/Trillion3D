import type { Side } from '../../../sdk-core/src/contracts/material.ts'
import type { Texture } from '../../../sdk-core/src/texture/contract.ts'
import type { MaterialGraph } from '../../../sdk-core/src/world/material/graph/api.ts'

/** The anisotropy and clear-coat maps, in the order their lobe extension names them
 *  (`../materials/table/lobeRecord.ts`). */
export const PHYSICAL_MAP_FIELDS = [
  'anisotropyMap',
  'clearcoatMap',
  'clearcoatRoughnessMap',
  'clearcoatNormalMap',
] as const

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
/** The subsurface map's rank in a record's UV channels word (`SURFACE_MAP_FIELDS` order, two bits
 *  a map): what both resolves read its coordinate by. */
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
  /** The units of the object's space one unit of each of its first four texture-coordinate sets
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
  /** The most of its history the temporal anti-aliasing keeps on its pixels, in [0, 1]
   *  (`HISTORY_SHARE_SHIFT`); 1, or none, the engine's own blend. */
  historyShare?: number
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
