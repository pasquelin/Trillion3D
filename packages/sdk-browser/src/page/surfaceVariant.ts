/**
 * THE VARIANT OF A MATERIAL'S SURFACE A MESH ASKS FOR, and the one rule that writes it.
 *
 * A material declares one record (`surfaceRecord.ts`); a mesh wearing it asks for what its own
 * geometry and draw carry — its vertex colours where it has some, flat shading where it has no
 * normal, both faces where a cloth draws it (`drawnTwoSided`) — the host loader's rules. Every
 * fact is read off the mesh, never off a registry: its geometry's attributes, and the association
 * its manifest gave it (`DrawRanks.twoSided`). A plain variant is the material's record itself;
 * another is a record of its own, copied from it once and kept by its owner (`variants`), so a
 * value written on the material is written on each (`../world/api/materialApi.ts`). A variant's
 * values are its material's: the material table holds one record for both (`variantPlain`), which
 * the rows read the variant's own facts beside — its faces, its colours — off their flags.
 */
import { Releasable } from '../host/graph/resource.ts'
import type { PageSurface } from './surface.ts'

/** What a mesh asks of the surface it wears. */
export type SurfaceVariant = { vertexColors: boolean; flatShading: boolean; twoSided: boolean }

/** A variant's key in a cache of surfaces by variant: the table's per rank and a created
 *  material's. */
export const variantKey = ({ vertexColors, flatShading, twoSided }: SurfaceVariant) =>
  `${vertexColors}:${flatShading}:${twoSided}`

/** The variant a mesh asks for: vertex colours where its geometry has some, flat shading where it
 *  has no normal, both faces where a cloth draws it. */
export const variantOf = (
  geometry: { attributes: Record<string, unknown> },
  twoSided: boolean,
): SurfaceVariant => ({
  vertexColors: geometry.attributes.color !== undefined,
  flatShading: geometry.attributes.normal === undefined,
  twoSided,
})

/** Each variant record's plain one: the record its material declares. */
const plains = new WeakMap<object, PageSurface>()

/** The record `surface` was worn from (`surfaceVariant`), or `surface` itself: what its material's
 *  one record in the material table is held under (`../webgpu/material/materialTable.ts`). */
export const variantPlain = (surface: object) => plains.get(surface) ?? surface

/** A record of its own with the fields of `record`, the variant's written over them, at
 *  version 0: the one place a variant becomes surface fields. */
function wear(record: PageSurface, { vertexColors, flatShading, twoSided }: SurfaceVariant) {
  const { released: _released, version: _version, ...fields } = record
  const surface = Object.assign(new Releasable(), fields, { version: 0 }) as PageSurface
  plains.set(surface, record)
  if (vertexColors) surface.vertexColors = true
  if (flatShading) surface.flatShading = true
  if (twoSided) surface.side = 'double'
  return surface
}

/** The surface of `plain`'s material in `variant`: `plain` itself for a plain variant, otherwise
 *  the record `variants` holds under its key, made from `plain` the first time. */
export function surfaceVariant(
  plain: PageSurface,
  variants: Map<string, PageSurface>,
  variant: SurfaceVariant,
) {
  if (!variant.vertexColors && !variant.flatShading && !variant.twoSided) return plain
  const key = variantKey(variant)
  let surface = variants.get(key)
  if (!surface) variants.set(key, (surface = wear(plain, variant)))
  return surface
}
