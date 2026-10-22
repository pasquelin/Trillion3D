/**
 * WHAT AN OWNER DECLARES OF ITS SURFACE, in the engine's words: the argument the one surface record
 * is filled from (`surfaceRecord.ts`), never kept.
 */
import type { Side } from '../../../../sdk-core/src/contracts/material.ts'
import type { Texture } from '../../../../sdk-core/src/texture/contract.ts'
import type { SurfaceDisplacement } from '../../visibility/materialType.ts'
import type { Blending } from '../../../../sdk-core/src/world/constants/index.ts'
import type { SurfaceFamily } from './surface.ts'
import type { HostColour } from '../../session/host/resources.ts'
import type { Vector2 } from '../../../../sdk-core/src/world/math/vector2.ts'
/** A map slot: the texture record the material names there, or nothing. */
export type Slot = Texture | null | undefined

/**
 * What an owner declares of its surface. Every field but the family is optional: unsaid, it takes
 * its silent value — white, opaque, front, normal blending, depth tested and written.
 */
export type SurfaceDeclaration = {
  readonly family: SurfaceFamily
  readonly name?: string
  readonly color?: HostColour
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
  readonly emissive?: HostColour
  readonly emissiveIntensity?: number
  readonly emissiveMap?: Slot
  readonly subsurfaceColor?: HostColour
  readonly subsurfaceMap?: Slot
  /** A Phong surface's exponent and highlight colour. */
  readonly shininess?: number
  readonly specular?: HostColour
  readonly anisotropy?: number
  readonly anisotropyRotation?: number
  readonly anisotropyMap?: Slot
  readonly clearcoat?: number
  readonly clearcoatRoughness?: number
  readonly clearcoatMap?: Slot
  readonly clearcoatRoughnessMap?: Slot
  readonly clearcoatNormalMap?: Slot
  readonly clearcoatNormalScale?: Pick<Vector2, 'x' | 'y'>
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
  readonly attenuationColor?: HostColour
  /** False keeps the surface outside the scene's fog. */
  readonly fog?: boolean
  /** The most of its history the temporal anti-aliasing keeps where the surface is drawn, in
   *  [0, 1] (`HISTORY_SHARE_SHIFT`): 0.75 a responsive history, 0 the current image alone.
   *  @defaultValue 1, the engine's own blend */
  readonly temporalAntialiasing?: number
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
  readonly forceSinglePass?: boolean
  readonly transparentShadow?: boolean
  readonly vertexColors?: boolean
  readonly depthTest?: boolean
  readonly depthWrite?: boolean
  readonly flatShading?: boolean
}
