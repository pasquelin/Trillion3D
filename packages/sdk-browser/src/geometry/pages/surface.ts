/**
 * The surface record a mesh wears: everything the engine path reads of a material, in the engine's
 * own words — one record per material, written by its owner (`surfaceRecord.ts`) and read IN PLACE
 * by every reader on the way to the image: the row writer, the coplanar
 * layer batches, the frame's cost snapshot, the transparent items, the witness that draws the same
 * scene. Comparing two surfaces is comparing two references; a write is journaled
 * (`surfaceWrites.ts`) and moves the record's version, which the memos keyed on it compare.
 *
 * Its shaded fields are exactly the ones the cache's material table declares
 * (`packages/sdk-core/src/scene/core/tableSurfaces.ts`); the raster facts beside them say how it is
 * composed; the few facts the engine draws through its one model but a family carries — a Phong
 * surface's exponent and highlight, the frame its normal factors were written for, its depth state
 * — are kept on it as declared, for a renderer that draws the family as it is.
 */
import { saturate } from '../../../../math/src/scalar/reals.ts'
import type { Blending } from '../../../../sdk-core/src/world/constants/index.ts'
import type { Releasable } from '../../../../sdk-core/src/runtime/releasable.ts'
import type { VisMaterial } from '../../visibility/materialType.ts'
import { declareSurface } from './surfaceRecord.ts'
import type { PageMaterials } from './pageMesh.ts'

/** The families a surface is declared in: a scene's unlit, standard and physical ones, and the
 *  others a world draws — the shadow catcher among them. The surface model reads the family
 *  (`../../materials/surface/surfaceModel.ts`). */
export type SurfaceFamily =
  | 'basic'
  | 'standard'
  | 'physical'
  | 'lambert'
  | 'phong'
  | 'toon'
  | 'normal'
  | 'matcap'
  | 'depth'
  | 'shadow'

/** The raster facts declared beside the shaded fields, and what a family keeps as declared. */
export type SurfaceFacts = {
  /** Bumped by every write (`surfaceWritten`). */
  version: number
  /** Its name. */
  name: string
  /** The family it was declared in. */
  family: SurfaceFamily
  /** How opaque it is, its colour factor's alpha. */
  opacity: number
  /** Whether it is drawn blended. */
  transparent: boolean
  /** How it composes over what is behind it. */
  blending: Blending
  /** A double-sided blended surface drawn in two passes, back then front, instead of one that
   *  culls neither (`Material.twoSidedPasses`). */
  twoSidedPasses: boolean
  /** Whether it tests and writes depth, and is shaded flat. */
  depthTest: boolean
  depthWrite: boolean
  flatShading: boolean
  /** Whether its normal factors were written for vertex tangents; unsaid, unknown. */
  forVertexTangents?: boolean
  /** A Phong surface's exponent and highlight colour, as declared. */
  shininess?: number
  specular?: [number, number, number]
}

/** The record a mesh wears: the shaded fields, the raster facts, and its release. */
export type PageSurface = VisMaterial & SurfaceFacts & Releasable

/** What a declaration of no surface at all (`material: []`) is drawn with: white, opaque, front,
 *  unlit. One record, never written. */
const NOTHING = declareSurface({ family: 'basic' })

/** The record `material` declares: the one surface it wears, or the first of a list — a list
 *  declaring nothing drawing as `NOTHING`. */
export const surfaceOf = (material: PageMaterials): PageSurface =>
  Array.isArray(material) ? (material[0] ?? NOTHING) : material

/** A surface's opacity, its colour factor's alpha, clamped: the light a blended one stops before
 *  its colour map's alpha, and what a masked one multiplies that alpha by before its cutoff. */
export const surfaceOpacity = (surface: { opacity: number }) => saturate(surface.opacity)

/** The record of a source's declaration: the collection's only door to a material. */
export const sourceSurface = (source: { declaration: PageMaterials }) =>
  surfaceOf(source.declaration)

/** Whether `source` wears one of `surfaces`: the record a repaint or an assignment names. */
export const wearsOneOf = (source: { declaration: PageMaterials }, surfaces: readonly object[]) =>
  surfaces.includes(sourceSurface(source))

/** The records of the source meshes a created material was assigned to. */
export const recordsOfMeshes = <T extends { drawSource?: object }>(
  records: readonly T[],
  meshes: ReadonlyMap<object, unknown>,
) => records.filter((rec) => !!rec.drawSource && meshes.has(rec.drawSource))

/** A record wears `declaration` from now on: its surface record. */
export function wearDeclaration(rec: { material: PageSurface }, declaration: PageMaterials) {
  rec.material = surfaceOf(declaration)
}
