/**
 * WHAT AN OWNER DECLARES OF ITS SURFACE, in the engine's words: the argument the one surface record
 * is filled from (`surfaceRecord.ts`), never kept.
 */
import type { ResponsiveLevel } from '../../../../sdk-core/src/contracts/materialAbi.ts'
import type { Side } from '../../../../sdk-core/src/contracts/material.ts'
import type { Texture } from '../../../../sdk-core/src/texture/contract.ts'
import type { SurfaceDisplacement } from '../../visibility/materialType.ts'
import type {
  Blending,
  TranslucencyLighting,
  TranslucencyPass,
} from '../../../../sdk-core/src/world/constants/index.ts'
import type { SurfaceFamily } from './surface.ts'
import type { Color } from '../../../../sdk-core/src/world/math/color.ts'
import type { Vector2 } from '../../../../sdk-core/src/world/math/vector2.ts'
import type { MaterialGraph } from '../../../../sdk-core/src/world/material/graph/api.ts'
import type { SubsurfaceProfileInput } from '../../../../sdk-core/src/lighting/subsurfaceProfile/profile.ts'
/** A colour a surface declares: three linear components, read one by one and never converted. */
export type SurfaceColour = Pick<Color, 'r' | 'g' | 'b'>

/** A map slot: the texture record the material names there, or nothing. */
export type Slot = Texture | null | undefined

/**
 * What an owner declares of its surface. Every field but the family is optional: unsaid, it takes
 * its silent value — white, opaque, front, normal blending, depth tested and written.
 */
export type SurfaceDeclaration = {
  readonly family: SurfaceFamily
  readonly name?: string
  readonly color?: SurfaceColour
  readonly map?: Slot
  /** A matcap surface's image; a toon surface's tone ramp, which no model reads (refused). */
  readonly matcap?: Slot
  readonly gradientMap?: Slot
  readonly metalness?: number
  readonly roughness?: number
  readonly metalnessMap?: Slot
  readonly roughnessMap?: Slot
  readonly normalMap?: Slot
  /** Two scale factors, a vector's two numbers. */
  readonly normalScale?: Pick<Vector2, 'x' | 'y'>
  /** Whether `normalScale` was written for a frame read from vertex tangents — the material
   *  table's tangent variant (`docs/FORMAT.md`); unsaid, unknown. */
  readonly forVertexTangents?: boolean
  readonly aoMap?: Slot
  readonly aoMapIntensity?: number
  readonly emissive?: SurfaceColour
  readonly emissiveIntensity?: number
  readonly emissiveMap?: Slot
  readonly subsurfaceColor?: SurfaceColour
  readonly subsurfaceMap?: Slot
  /** How opaque its subsurface is, 0 to 1. @defaultValue 1 */
  readonly subsurfaceOpacity?: number
  /** The subsurface profile of its pixels of the subsurface-profile and eye models (`SubsurfaceProfile`), the default skin's where unsaid. */
  readonly subsurfaceProfile?: SubsurfaceProfileInput | null
  /** The shading model of the material (`MaterialShadingModel`), `defaultLit` where unsaid, and the iris share of an eye. */
  readonly shadingModel?: string
  readonly irisMask?: number
  readonly irisDistance?: number
  /** A Phong surface's exponent and highlight colour. */
  readonly shininess?: number
  readonly specular?: SurfaceColour
  readonly anisotropy?: number
  readonly anisotropyRotation?: number
  readonly anisotropyMap?: Slot
  readonly clearcoat?: number
  readonly clearcoatRoughness?: number
  readonly clearcoatMap?: Slot
  readonly clearcoatRoughnessMap?: Slot
  readonly clearcoatNormalMap?: Slot
  readonly clearcoatNormalScale?: Pick<Vector2, 'x' | 'y'>
  /** The cloth shading model: switched on above 0 (unless a coat or a transmission takes the surface
   *  first), its fuzz colour and its cloth amount, the sheen roughness, and their maps. */
  readonly sheen?: number
  readonly sheenColor?: SurfaceColour
  readonly sheenRoughness?: number
  readonly sheenColorMap?: Slot
  readonly sheenRoughnessMap?: Slot
  /** The specular input of a physical surface's dielectric, which a glTF `KHR_materials_specular`
   *  factor declares, and the map whose alpha scales it; unsaid, the surface keeps 0.5. */
  readonly specularIntensity?: number
  readonly specularIntensityMap?: Slot
  /** The displacement the tessellation draws the surface with (`TESSELLATION_RULES`): the height map
   *  and what the table resolved of the material (`TableDisplacement`); a surface without a map
   *  is not displaced. */
  readonly displacementMap?: Slot
  readonly displacement?: SurfaceDisplacement
  readonly transmission?: number
  readonly ior?: number
  readonly thickness?: number
  /** `Infinity`, or unsaid, when the volume attenuates nothing. */
  readonly attenuationDistance?: number
  readonly attenuationColor?: SurfaceColour
  /** False keeps the surface outside the scene's fog. */
  readonly fog?: boolean
  /** True lets its graph's emission be negative (`VisMaterial.allowNegativeEmissive`). */
  readonly allowNegativeEmissive?: boolean
  /** The clip value of its graph's `opacityMask` and whether that mask is dithered
   *  (`VisMaterial.opacityMaskClipValue`, `ditherOpacityMask`). */
  readonly opacityMaskClipValue?: number
  readonly ditherOpacityMask?: boolean
  /** True takes a roughness from the change of its vertex normal (`VisMaterial.normalCurvatureToRoughness`). */
  readonly normalCurvatureToRoughness?: boolean
  /** What its graph's `worldPositionOffset` output asks of the offset (`VisMaterial.maxWorldPositionOffset`
   *  and the one after it). */
  readonly maxWorldPositionOffset?: number
  readonly alwaysEvaluateWorldPositionOffset?: boolean
  /** True lets the clouds in front of a fogged, blended surface be laid over its fog (`VisMaterial.cloudFog`). */
  readonly cloudFog?: boolean
  /** True works the fog of a blended surface out for each pixel, not each vertex (`VisMaterial.computeFogPerPixel`). */
  readonly computeFogPerPixel?: boolean
  /** How a blended surface reads the shadow of the lights that reach it, beyond the project's
   *  switches (`VisMaterial.translucentLocalLightShadow` and the two after it). */
  readonly translucentLocalLightShadow?: boolean
  readonly translucentLocalLightShadowQuality?: number
  readonly translucentDirectionalLightShadowQuality?: number
  /** How the lights light a blended surface (`VisMaterial.translucencyLighting`). */
  readonly translucencyLighting?: TranslucencyLighting
  /** The pass of the image a blended surface is drawn in (`VisMaterial.translucencyPass`). */
  readonly translucencyPass?: TranslucencyPass
  /** How far the temporal anti-aliasing trusts the history where the surface is drawn
   *  (`RESPONSIVE_SHIFT`): `'medium'` reads its pixels as a pixel animation, `'full'` restarts
   *  their history every image.
   *  @defaultValue `'off'`, the normal accumulation */
  readonly responsive?: ResponsiveLevel
  readonly lineWidth?: number
  readonly dashSize?: number
  readonly gapSize?: number
  readonly sprite?: boolean
  readonly rotation?: number
  readonly sizeAttenuation?: boolean
  readonly side?: Side
  readonly opacity?: number
  readonly alphaTest?: number
  readonly transparent?: boolean
  readonly blending?: Blending
  readonly twoSidedPasses?: boolean
  readonly vertexColors?: boolean
  readonly depthTest?: boolean
  readonly depthWrite?: boolean
  readonly flatShading?: boolean
  /** The graph that computes the outputs in place of the parameters and maps; read by the families
   *  that draw the material's colour (`GRAPH_FAMILIES`, `surfaceRecord.ts`). */
  readonly graph?: MaterialGraph
}
