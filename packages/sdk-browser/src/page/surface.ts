/**
 * The surface record a page carries: everything the engine path reads of a material, in the
 * engine's own words, and nothing of the host object it was read from.
 *
 * A page does not carry the host material declaration itself: every reader on the
 * way to the image — the cut's normal cones, the row writer, the software raster, the coplanar
 * layer batches, the frame audit, the transparent items — takes a side, a
 * transparency flag, a colour from this record. The record below is read ONCE per declaration, at
 * the two boundaries that own that read (`../host/surfaceImport.ts` for the shaded fields,
 * `../scene/materialSide.ts` for the raster ones); downstream no file of the engine path names a
 * host material again.
 *
 * Its shaded fields are exactly the ones the cache's material table declares (
 * `packages/sdk-core/src/scene/core/tableSurfaces.ts`), and the host declaration it is read from
 * is itself built from that table (`../host/prepared/materials.ts`).
 *
 * A record is held BY its declaration and refilled IN PLACE, so every page of every placement of
 * one surface shares a single record and comparing two surfaces is comparing two references. A
 * page keeps the record alone, never the host declaration it was read from.
 */
import type { Side } from '../../../sdk-core/src/index.ts'
import type { HostMaterials } from '../host/resources.ts'
import { isAssignment, type AlphaChange } from '../placement/engineSceneUpdates.ts'
import type { HostShadedMaterial } from '../host/shadedMaterial.ts'
import { unreadMapRefusal } from '../scene/surfaceModel.ts'
import {
  firstMaterial,
  materialRaster,
  sideOf,
  type MaterialRaster,
} from '../scene/materialSide.ts'
import { visMaterial } from '../visibility/shader/material.ts'
import type { VisMaterial } from '../visibility/types.ts'

/** The shaded fields of a surface, and the raster facts declared beside them. */
export type PageSurface = VisMaterial & MaterialRaster

/**
 * The side a record declares, in the engine's own enum, AS THE HOST DECLARES IT NOW.
 *
 * Every reader of the side goes through this pair, and both reread the declaration first: a host
 * switches a surface to double-sided by writing `side` on the declaration it shares with its mesh,
 * without bumping any version, and the readers that answer with it decide what is drawn — the
 * pipelines and their face culling (`../webgpu/pages/prepare/pipelineFor.ts`), the cut's normal cones
 * (`../gpu/core/selection.ts`, `cone/cone.ts`, `../webgpu/pages/prepare/preparePages.ts`) and the transparent plan. A front-only
 * page carries a closed cone; read a stale `front` on a surface the host has just opened and the
 * cone rejects the page — its faces leave the image.
 */
export const surfaceSide = (surface: PageSurface): Side => {
  const now = refreshSide(surface)
  return now.doubleSided ? 'double' : now.backSide ? 'back' : 'front'
}
/** True when only the front faces are drawn: the one case a normal cone may reject a page. */
export const surfaceFrontOnly = (surface: PageSurface) => surfaceSide(surface) === 'front'

/** A surface's opacity, its colour factor's alpha, clamped: the light a blended one stops before
 *  its colour map's alpha, and what a masked one multiplies that alpha by before its cutoff. */
export const surfaceOpacity = (surface: { opacity: number }) =>
  Math.min(1, Math.max(0, surface.opacity))

const held = new WeakMap<object, PageSurface>()
const declarations = new WeakMap<PageSurface, HostMaterials>()

/** Fills a record from a declaration, reusing the object so every holder sees the new fields. A
 *  map its model never reads is refused by name (`unreadMapRefusal`). */
function fill(into: PageSurface, material: HostMaterials): PageSurface {
  const host = firstMaterial(material) as HostShadedMaterial | undefined,
    unread = host && unreadMapRefusal(host)
  if (unread) throw new Error(unread)
  return materialRaster(material, Object.assign(into, visMaterial(material)))
}

/**
 * The engine record of a host declaration, built at its first page and reread when the host
 * rewrites the declaration in place. Called at the boundaries that hold a host material — the
 * collection, a witness that repaints its pages, the refresh of surfaces a page changed the alpha
 * of — and nowhere else.
 */
export function surfaceOf(material: HostMaterials): PageSurface {
  const kept = held.get(material as object)
  if (kept) return refreshSurface(kept)
  const surface = fill({} as PageSurface, material)
  held.set(material as object, surface)
  declarations.set(surface, material)
  return surface
}

/** The record of a drawn mesh's declaration: the collection's only door to a host material. */
export const meshSurface = (mesh: { material: HostMaterials }) => surfaceOf(mesh.material)

/**
 * Rereads the SIDE of a record from the declaration it was built from; a record built outside this
 * module — a fixture's — keeps the fields it was given. Two field writes and a lookup: this is the
 * per-page, per-draw read the engine would otherwise make on the host declaration itself.
 */
function refreshSide(surface: PageSurface): PageSurface {
  const material = declarations.get(surface)
  if (!material) return surface
  const side = sideOf(material)
  surface.doubleSided = side === 'double'
  surface.backSide = side === 'back'
  return surface
}

/**
 * Rereads a record whose declaration the host has rewritten, and returns it either way; a record
 * built outside this module — a fixture's — is returned untouched.
 *
 * The raster facts are reread on every call: a host writes `side`, `alphaTest` or `opacity` on
 * the declaration it shares with its mesh without bumping any version, and the transparent plan
 * (`../webgpu/blend/plan.ts`) and the software raster (`../visibility/raster.ts`) have to see it between
 * two images. The shaded fields, which walk the six map slots, are reread only when the version
 * moved — the comparison the page row already made before writing.
 */
export function refreshSurface(surface: PageSurface): PageSurface {
  const material = declarations.get(surface)
  if (!material) return surface
  if ((firstMaterial(material)?.version ?? 0) !== surface.version) return fill(surface, material)
  refreshSide(surface)
  return materialRaster(material, surface)
}

/** The records of the source meshes a created material was assigned to. */
export const recordsOfMeshes = <T extends { sourceMesh?: object }>(
  records: readonly T[],
  meshes: ReadonlyMap<object, unknown>,
) => records.filter((rec) => !!rec.sourceMesh && meshes.has(rec.sourceMesh))

/** The records of each surface an assignment gives (`SurfaceAssignment`): each mesh's own. */
export function recordsBySurface<T extends { sourceMesh?: object }>(
  records: readonly T[],
  meshes: ReadonlyMap<object, object>,
) {
  const by = new Map<object, T[]>()
  for (const rec of recordsOfMeshes(records, meshes)) {
    const surface = meshes.get(rec.sourceMesh!)!
    let list = by.get(surface)
    if (!list) by.set(surface, (list = []))
    list.push(rec)
  }
  return by
}

/** Why neither engine gives an assigned mesh another surface: none of its records is a page's,
 *  it is drawn as a forward copy the open laid out, off the surface the copy took then. */
export function unpagedRefusal(records: readonly { sourceMesh?: object }[], alpha: AlphaChange) {
  if (!isAssignment(alpha)) return
  const unpaged = new Set(alpha.meshes.keys())
  for (const rec of records) if (rec.sourceMesh) unpaged.delete(rec.sourceMesh)
  if (unpaged.size) return 'the drawable is drawn as a forward copy laid out when the session opens'
}

/** A record wears `declaration` from now on: its surface record, read at this boundary. */
export function wearDeclaration(rec: { material: PageSurface }, declaration: HostMaterials) {
  rec.material = surfaceOf(declaration)
}
