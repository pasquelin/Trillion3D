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
 *    resident in the pool; its residency is mirrored from that placement (`gpu/dag/residencyMirror.ts`).
 *
 * A super-root whose primitive draws blended, or that no mesh of the scene wears, is a record
 * without a page, as an object's is: it never draws, and the placements of that primitive are
 * linked to no world cluster, so they always draw themselves (`objectOfRoot`).
 *
 * Every band is the cook's, raised by the world's largest quantization displacement, the same for
 * every cluster (`worldRootPages`): a placement's link compares its object's parent band with its
 * group's super-roots' own band (`gpu/dag/worldLinks.ts`), and both stay equal.
 */
import { drawsBlended } from '../page/selection/collect.ts'
import type { PageRec, ClusterRoot } from '../page/selection/types.ts'
import type { PageSurface } from '../page/surface.ts'
import { cullingBounds } from '../page/cut/bounds.ts'
import { cullingLinks } from '../page/cut/links.ts'
import { IDENTITY_WORLD } from '../host/matrixElements.ts'
import { BOX_VALUES } from '../../../sdk-core/src/index.ts'
import type { worldRootDag } from './worldSuperRoots.ts'
import type { Primitive } from '../../../sdk-core/src/index.ts'
import { primitiveFinder } from './primitiveLookup.ts'
import { sourceSurface } from '../page/surface.ts'
import type { DrawSource } from '../page/selection/drawSource.ts'
import { placementWorld, rowParked, type PlacementRows } from '../placement/rows.ts'
import { refreshRootBox } from '../page/selection/batchBoxes.ts'

/** The mesh a world page is worn by, and its surface: none when it draws blended. */
export type WorldWearer = { drawSource: DrawSource; surface: PageSurface }

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
    attributes: wearer.drawSource.attributes,
    material: wearer.surface,
    transparent: false,
    drawSource: wearer.drawSource,
    renderOrder: order,
  }
}

/**
 * The cut's root of the world DAG `dag`: its records worn through `wear` (a primitive's rank to the
 * mesh that draws it opaque, none otherwise), its group structure and culling hierarchy over them,
 * drawn at the identity — or at the world of its model, row 0 of `pose` —, ranked `order` among the
 * draws; `undefined` when no mesh wears any of it.
 */
export function worldSelectionRoot(
  dag: WorldDagSource,
  wear: (primitive: number) => WorldWearer | undefined,
  order: number,
  pose?: PlacementRows,
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
  // The world box: the root node's of the cook's hierarchy, as a primitive's local box.
  const nodes = dag.culling
  if (!nodes) throw new Error('WORLD_CULLING_MISSING')
  const worldBox = nodes.nodes.slice(0, BOX_VALUES),
    held = new Map<number, PageRec[]>()
  // The roots each bundle holds for its cell, those with a page alone: a record without one is
  // not a page, never held nor covered.
  for (const [bundle, ranks] of dag.held) {
    const own = ranks.map((rank) => pages[rank]).filter((page) => page.url)
    if (own.length) held.set(bundle, own)
  }
  const placement = pose && { rows: pose, index: 0 }
  const root = {
    world: placement ? placementWorld(pose, 0) : IDENTITY_WORLD,
    ...(placement && { placement, parked: rowParked(placement) }),
    pages,
    structure: dag.structure,
    culling: {
      nodes: nodes.nodes,
      stride: nodes.stride,
      bounds: cullingBounds(nodes, pages),
      links: cullingLinks(nodes, pages.length),
    },
    worldBox,
    localBox: worldBox,
    boxes: true,
    origins: dag.origins,
    pagesOf: (bundle: number) => held.get(bundle) ?? [],
  }
  // Posed by its model: its box is the local one at that world.
  if (placement) refreshRootBox(root)
  return root
}

/** The world DAG's root as the cut packs it: each placed object's origin, and the pages each
 *  bundle past the pinned top holds for its cell (`pagesOf`), which join the cover with it. */
export type WorldHeld = {
  origins: Int32Array
  pagesOf: (bundle: number) => readonly PageRec[]
}

/**
 * Each primitive rank of `primitives` to the source of `draws` that draws it opaque, and its
 * surface, as a page record wears them (`../page/selection/collect.ts`): none for a primitive no
 * source draws, or one drawn blended, which no world page stands in for.
 */
export function worldWearers(draws: readonly DrawSource[], primitives: readonly Primitive[]) {
  // Each manifest primitive to the first source that draws it, found by its ranks.
  const find = primitiveFinder(primitives),
    byPrimitive = new Map<Primitive, DrawSource>()
  for (const draw of draws) {
    const primitive = find({ meshes: draw.mesh, primitives: draw.primitives })
    if (primitive && !byPrimitive.has(primitive)) byPrimitive.set(primitive, draw)
  }
  return (rank: number): WorldWearer | undefined => {
    const primitive = primitives[rank],
      drawSource = primitive && byPrimitive.get(primitive)
    if (!drawSource) return undefined
    const surface = sourceSurface(drawSource)
    return drawsBlended(primitive, surface) ? undefined : { drawSource, surface }
  }
}
