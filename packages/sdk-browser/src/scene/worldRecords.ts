/**
 * THE WORLD DAG AS THE CUT'S PAGE RECORDS.
 *
 * The world DAG (`worldSuperRoots.ts`) is the far field of an open world: a cell's super-roots, the
 * levels that join several cells, up to the world top. Packed as the cut's last root, its pages are
 * records like a primitive's (`../page/selection/collectRecords.ts`), so the one cut chooses them,
 * the one pool holds them and the one raster draws them:
 *
 *  - a super-root is a geometry page in world space (`world-roots.bin`, read through the world
 *    page server, `worldPageServe.ts`), worn in the surface of the primitive its cluster names
 *    (`primitive`): every object of its build wears the same material, so the material's own
 *    textures draw it, at the texture coordinates the cook carried through its simplification;
 *  - a placed object's cluster has no page: its own placement draws it. Its record is never
 *    resident in the pool; its residency is mirrored from that placement (`gpu/dag/worldMirror.ts`).
 *
 * A super-root whose primitive draws blended, or that no mesh of the scene wears, is a record
 * without a page, as an object's is: it never draws, and the placements of that primitive are
 * linked to no world cluster, so they always draw themselves (`objectOfRoot`).
 *
 * Every band is the cook's, raised by the world's largest quantization displacement, the same for
 * every cluster (`worldRootPages`): a placement's link compares its object's parent band with its
 * group's super-roots' own band (`gpu/dag/worldLinks.ts`), and both stay equal.
 */
import type { PageRec, ClusterRoot } from '../page/selection/types.ts'
import type { PageSurface } from '../page/surface.ts'
import type { HostMesh } from '../host/resources.ts'
import { cullingBounds } from '../page/cut/bounds.ts'
import { cullingLinks } from '../page/cut/links.ts'
import { flatHierarchy } from '../gpu/dag/hierarchy.ts'
import { IDENTITY_WORLD } from '../host/matrixElements.ts'
import { BOX_VALUES } from '../../../sdk-core/src/index.ts'
import type { worldRootDag } from './worldSuperRoots.ts'
import type { Object3D } from '../../../sdk-core/src/world/object/object3d.ts'
import type { Primitive } from '../../../sdk-core/src/index.ts'
import { meshes } from './meshes.ts'
import { meshSurface } from '../page/surface.ts'

/** The mesh a world page is worn by, and its surface: none when it draws blended. */
export type WorldWearer = { mesh: HostMesh; surface: PageSurface }

/** The world DAG as the stream reads it (`worldRootDag`). */
type WorldDagSource = NonNullable<ReturnType<typeof worldRootDag>>
type WorldPage = WorldDagSource['pages'][number]

/** The record of world cluster `rank`, its page drawn when `wearer` wears it. */
function worldRecord(page: WorldPage, rank: number, wearer: WorldWearer, order: number): PageRec {
  const facts = page.url && page.page
  return {
    id: rank,
    url: facts ? page.url : '',
    clusterId: `world-roots:${rank}`,
    triangles: page.triangles,
    indexBytes: facts ? facts.bytes : 0,
    ...(facts && {
      geometryPage: {
        url: page.url,
        sha256: '',
        bytes: facts.bytes,
        vertexCount: facts.vertexCount,
        indexCount: facts.indexCount,
        flags: facts.flags,
        uncompressedBytes: facts.uncompressedBytes,
      },
    }),
    min: page.min,
    max: page.max,
    role: 'coarse',
    level: page.level,
    lodError: page.lodError,
    sphere: page.sphere,
    parentError: page.parentError,
    parentSphere: page.parentSphere,
    // A root its cell holds joins the cover with the cell, never at open (`PageRec.holder`).
    ...(page.holder !== undefined && { holder: page.holder }),
    depthLayer: 0,
    attributes: wearer.mesh.geometry.attributes,
    material: wearer.surface,
    transparent: false,
    sourceMesh: wearer.mesh,
    renderOrder: order,
  }
}

/**
 * The cut's root of the world DAG `dag`: its records worn through `wear` (a primitive's rank to the
 * mesh that draws it opaque, none otherwise), its group structure and culling hierarchy over them,
 * drawn at the identity, ranked `order` among the draws; `undefined` when no mesh wears any of it.
 */
export function worldSelectionRoot(
  dag: WorldDagSource,
  wear: (primitive: number) => WorldWearer | undefined,
  order: number,
): (ClusterRoot<PageRec> & WorldHeld) | undefined {
  let fallback: WorldWearer | undefined
  for (const { primitive } of dag.pages)
    if ((fallback = primitive === null ? undefined : wear(primitive))) break
  if (!fallback) return undefined
  const pages = dag.pages.map((page, rank) => {
    const wearer = page.primitive === null ? undefined : wear(page.primitive)
    // No wearer: a record without a page, worn as any other only to stay a record.
    return worldRecord(wearer ? page : { ...page, url: '' }, rank, wearer ?? fallback, order)
  })
  // The world box: the root node's of the hierarchy over its pages, as a primitive's local box.
  const nodes = flatHierarchy(pages),
    worldBox = nodes.nodes.slice(0, BOX_VALUES),
    held = new Map<number, PageRec[]>()
  // The roots each bundle holds for its cell, those with a page alone: a record without one is
  // not a page, never held nor covered.
  for (const [bundle, ranks] of dag.held) {
    const own = ranks.map((rank) => pages[rank]).filter((page) => page.url)
    if (own.length) held.set(bundle, own)
  }
  return {
    world: IDENTITY_WORLD,
    pages,
    structure: dag.structure,
    culling: {
      ...nodes,
      bounds: cullingBounds(nodes, pages),
      links: cullingLinks(nodes, pages.length),
    },
    worldBox,
    localBox: worldBox,
    boxes: true,
    origins: dag.origins,
    pagesOf: (bundle: number) => held.get(bundle) ?? [],
  }
}

/** The world DAG's root as the cut packs it: each placed object's origin, and the pages each
 *  bundle past the pinned top holds for its cell (`pagesOf`), which join the cover with it. */
export type WorldHeld = {
  origins: Int32Array
  pagesOf: (bundle: number) => readonly PageRec[]
}

/**
 * Each primitive rank of `primitives` to the mesh of `source` that draws it opaque, and its surface,
 * as a page record wears them (`../page/selection/collect.ts`): none for a primitive no mesh draws,
 * or one drawn blended, which no world page stands in for.
 */
export function worldWearers(
  source: Object3D,
  primitives: readonly Primitive[],
  associations: ReadonlyMap<Object3D, { meshes?: number; primitives?: number }>,
) {
  const byKey = new Map<string, HostMesh>()
  for (const mesh of meshes(source)) {
    const association = associations.get(mesh),
      key = `${association?.meshes}/${association?.primitives ?? 0}`
    if (association && !byKey.has(key)) byKey.set(key, mesh)
  }
  return (rank: number): WorldWearer | undefined => {
    const primitive = primitives[rank],
      mesh = primitive && byKey.get(`${primitive.mesh}/${primitive.primitive}`)
    if (!mesh) return undefined
    const surface = meshSurface(mesh)
    const blended = primitive.pass === 'clustered-blend' || primitive.pass === 'shared-blend'
    return blended || surface.transparent || surface.transmission > 0
      ? undefined
      : { mesh, surface }
  }
}
