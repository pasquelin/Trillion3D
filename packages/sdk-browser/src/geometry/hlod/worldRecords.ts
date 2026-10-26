/**
 * THE WORLD DAG AS THE CUT'S PAGE RECORDS.
 *
 * The world DAG (`worldHlod.ts`) is the world's HLOD 1 to 3: per HLOD cell, one actor built into
 * its own DAG. Packed as the cut's last roots — one per placement of its model —, its pages are
 * records like a primitive's (`../selection/collectRecords.ts`), so the one cut chooses them, the
 * one pool holds them and the one raster draws them: each a geometry page in world space
 * (`world-roots.bin`, named by `worldRootPages.ts`, read through `worldRuns.ts`), worn in the
 * flattened material of its actor (`material`): the scene's own surface built from the material
 * table (`../../scene/host/prepared/materials.ts`), its atlas textures streamed as any texture, at
 * the texture coordinates the cook unwrapped (`hlod/flatten`). Each record names its HLOD layer,
 * which the HLOD view paints (`../selection/diagnostic.ts`). No mesh of the scene draws an actor:
 * its records name no draw source, and none of its pages follows a node's visibility.
 */
import type { PageRec, ClusterRoot } from '../selection/types.ts'
import type { PageSurface } from '../pages/surface.ts'
import { IDENTITY_WORLD } from '../../session/host/matrixElements.ts'
import { BOX_VALUES } from '../../../../math/src/geometry/box.ts'
import type { WorldDagRoot } from './worldHlod.ts'
import type { PlacementRows } from '../../placement/rows/rows.ts'
import { placementsOf } from '../../placement/roots/roots.ts'
import { surfaceBlends } from '../selection/collectBlend.ts'

/** A paged record reads its vertices from its page: it holds no host attribute. */
const PAGED: PageRec['attributes'] = {}

type WorldPage = WorldDagRoot['pages'][number]

/** The record of world cluster `rank`, worn in `surface`. */
function worldRecord(page: WorldPage, rank: number, surface: PageSurface, order: number): PageRec {
  const facts = page.url && page.page
  return {
    id: rank,
    url: facts ? page.url : '',
    clusterId: `world-roots:${rank}`,
    // Without a page it draws none.
    triangles: facts ? page.triangles : 0,
    indexBytes: facts ? facts.bytes : 0,
    ...(facts && {
      geometryPage: {
        url: page.url,
        sha256: '',
        bytes: facts.bytes,
        residentBytes: facts.residentBytes,
        residentOffset: facts.residentOffset,
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
    hlodLayer: page.layer,
    lodError: page.lodError,
    sphere: page.sphere,
    parentError: page.parentError,
    parentSphere: page.parentSphere,
    // The streaming page it lies in, the unit the residency streams (`PageRec.streamUrl`).
    ...(facts && page.stream && { streamUrl: page.stream.url, streamOffset: page.stream.offset }),
    // A page of the root page its cell holds joins the cover with the cell, never at open
    // (`PageRec.holder`, `worldRootPages.ts`).
    ...(page.holder !== undefined && { holder: page.holder }),
    depthLayer: 0,
    attributes: PAGED,
    material: surface,
    // Blended as the surface it wears is: a merged layer's section wearing a blended or
    // transmissive material of the scene is drawn by the transparent pass, as any
    // translucent section (`ClusterRoot.mixed`); a flattened material is opaque. A cutout is tested
    // as any opaque page's (`geometry/rows/surfaceRow.ts`, `FLAG_MASK`).
    transparent: surfaceBlends(surface),
    renderOrder: order,
  }
}

/**
 * The cut's roots of the world DAG `dag`: its records worn in `surfaces` (each actor's flattened
 * material, by the rank its clusters name), its group structure and culling hierarchy over them,
 * drawn at the identity — or one root per row of `pose`, each placement of its model at its own
 * world, parked while its row is, as a mesh source's rows place it —, ranked `order` among the
 * draws; none when its pages wear no surface yet. A DAG of no page — actors all rows — wears none
 * and is placed all the same: its roots carry the switch (`../dag/worlds/worldLinks.ts`). Every
 * root shares the records, the hierarchy and the held pages: a placement more adds a root, never
 * a record. Rows a growth adds are cloned from them (`../../placement/growth/growth.ts`).
 */
export function worldSelectionRoots(
  dag: WorldDagRoot,
  surfaces: readonly PageSurface[],
  order: number,
  pose?: PlacementRows,
): (ClusterRoot<PageRec> & WorldHeld)[] {
  const fallback = surfaces[0]
  if (!fallback && dag.pages.length) return []
  const pages = dag.pages.map((page, rank) => {
    const surface = surfaces[page.material]
    // No surface: a record without a page, worn as any other only to stay a record.
    return worldRecord(surface ? page : { ...page, url: '' }, rank, surface ?? fallback, order)
  })
  // The local box: the root node's of the cook's hierarchy, as a primitive's; its world box its own.
  // The hierarchy, its bounds and links as the DAG made them (`worldRootDag`).
  const culling = dag.culling
  if (!culling) throw new Error('WORLD_CULLING_MISSING')
  const localBox = culling.nodes.slice(0, BOX_VALUES),
    held = new Map<number, PageRec[]>()
  // The pages each root page holds for its HLOD cell, those with a page alone: a record without
  // one is not a page, never held nor covered.
  for (const [bundle, ranks] of dag.held) {
    const own = ranks.map((rank) => pages[rank]).filter((page) => page.url)
    if (own.length) held.set(bundle, own)
  }
  const shared = {
    pages,
    // Opaque and blended pages both, when a section wears a blended material (`rootBlends`).
    ...(pages.some((page) => page.transparent) && { mixed: true }),
    structure: dag.structure,
    culling,
    localBox,
    boxes: true,
    hlod: dag.hlod,
    pagesOf: (bundle: number) => held.get(bundle) ?? [],
  }
  return placementsOf(pose && { placements: pose }, () => IDENTITY_WORLD).map((placed) => ({
    ...shared,
    ...placed,
    worldBox: localBox.slice(),
  }))
}

/** The world DAG's root as the cut packs it: each rank's HLOD cell, and the pages each bundle
 *  holds for its cell (`pagesOf`), which join the cover with it. */
export type WorldHeld = {
  hlod: WorldDagRoot['hlod']
  pagesOf: (bundle: number) => readonly PageRec[]
}
