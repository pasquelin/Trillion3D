import { BOX_VALUES } from '../../../../math/src/geometry/box.ts'
import type { ClusterManifest, Primitive } from '../../../../sdk-core/src/contracts/geometry.ts'
import { sourceSurface, type PageSurface } from '../pages/surface.ts'
import { spriteMark } from '../../visibility/shader/spriteWgsl.ts'
import {
  NO_DISTANCE_FIELD_ROOT,
  SHADOWLESS_ROOT,
  withCasting,
} from '../../visibility/shader/castingMark.ts'
import { primitiveFinder } from '../../scene/primitiveLookup.ts'
import { createPrimitiveTemplates } from './template.ts'
import { createPageRecords } from './collectRecords.ts'
import { indexPageRequests } from './requests.ts'
import { linkBundleDependencies } from './bundleDependencies.ts'
import { hostWorldPlacements } from '../../scene/host/world/placements.ts'
import type { PageRec, ClusterRoot } from './types.ts'
import { placementsOf, type Placed } from '../../placement/roots/roots.ts'
import type { DrawSource } from './drawSource.ts'
import { rowCasting, rowDrawDistance, rowRootParent } from '../../placement/rows/rows.ts'
import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'
import { blendOf, noteCollected, pagesBlend, wears } from './collectBlend.ts'
/** One primitive drawn by pages: its source mesh, the surface it wears, its records and shape —
 *  shared by every placement. */
type Drawn = {
  source: DrawSource
  primitive: Primitive
  surface: PageSurface
  pages: PageRec[]
  shape: ReturnType<ReturnType<typeof createPrimitiveTemplates>['shapeOf']>
}

/** One root per placement of a primitive drawn by pages: its world and box, the primitive's
 *  nodes and links shared by all. */
function rootsOf(drawn: Drawn, placed: readonly Placed[], roots: ClusterRoot<PageRec>[]) {
  const { source, primitive, surface, pages, shape } = drawn,
    { structure, culling } = shape
  const sharedCulling = culling && { ...culling, links: shape.links }
  for (const { world, parked, placement } of placed) {
    // A row says its own distances; a node placed at its own world, its mesh's.
    const drawDistance = placement ? rowDrawDistance(placement) : source.drawDistance
    // An instance of an assembly: the group above its root, from its row or its node.
    const rootParent = placement ? rowRootParent(placement) : source.rootParent
    const root: ClusterRoot<PageRec> = {
      world,
      mesh: primitive.mesh,
      primitive: primitive.primitive,
      pages,
      // Nodes and their links are the primitive's, shared by all its placements.
      culling: sharedCulling,
      worldBox: new Float64Array(BOX_VALUES),
      localBox: shape.local,
      structure,
      // Every record has the manifest's `min` and `max` (the page contract): none is checked.
      boxes: true,
      parked,
      placement,
      // The surface its placement wears (`worn`), which the surface cache's cards are captured with.
      worn: { surface },
      // How far its GPU deformation can move a vertex, measured by the compiler (#357).
      ...(primitive.deformation ? { deformation: primitive.deformation } : {}),
      ...(drawDistance ? { drawDistance } : {}),
      ...(rootParent ? { rootParent } : {}),
      // A row says how its placement casts; a node placed at its own world, its mesh.
      mark:
        withCasting(spriteMark(surface), placement ? rowCasting(placement) : source.casting) ||
        undefined,
    }
    roots.push(root)
  }
}

/** What a collection fills: the roots and the records; the forward copies are the blended roots'
 *  (`pagedBlendCopiesOf`). The root cover is the roots' own (`rootCoverage`, `selection.ts`). */
export type Collected = {
  roots: ClusterRoot<PageRec>[]
  allPages: PageRec[]
}
/** An empty collection. */
export const collectedSink = (): Collected => ({
  roots: [],
  allPages: [],
})

/**
 * The collection of a scene's sources, one `add` each, placed where its node stands or at each row
 * that places it. `source` is the graph the nodes of the sources live in, whose world matrices the
 * engine reads in place. A source added later, to a session in place, runs the same function on
 * its own content (`addPlacements`).
 *
 * ONE record per primitive page (#1235), shared by every placement of a source object: its world,
 * its row and its packed rank are the layout's, never a field of it. A mesh has a distance-field
 * representation where it has a field and casts a dynamic shadow (its affecting the distance-field
 * lighting is the default, which no node turns off).
 */
export function createCollector(
  source: Object3D,
  metadata: ClusterManifest,
  indices: Map<string, Uint32Array>,
  options: {
    allowMissing?: boolean
    /** Leaves out a mesh placed by rows whose primitive is not read yet, mounted later (#751). */
    pendingPlaced?: boolean
    /** The compiled meshes that have a distance field (`distanceFieldMeshes`): their pages carry
     *  `PageRec.distanceField` where their source casts a shadow. */
    distanceFieldMeshes?: ReadonlySet<number>
  } = {},
) {
  const worlds = hostWorldPlacements(source)
  const primitiveOf = primitiveFinder(metadata.primitives)
  // One template per source object, shared by all its placements: the DAG shape, its error
  // bands and cluster identities depend on no world matrix.
  const templates = createPrimitiveTemplates(indices, options.allowMissing === true)
  /** The sources added, in order: those the open collected, then those that joined. */
  const sources: DrawSource[] = []
  let order = 0
  /** `draw`'s records and roots, into `into`; the primitive it draws, none when it is skipped. */
  const add = (draw: DrawSource, into: Collected) => {
    const primitive = primitiveOf({ meshes: draw.mesh, primitives: draw.primitives })
    if (!primitive && options.pendingPlaced && draw.rows) return undefined
    if (!primitive)
      throw new Error(`Missing primitive association: ${draw.mesh}/${draw.primitives ?? 0}`)
    sources.push(draw)
    // One root per placement: the node's pose, or each row that places the source (`placementsOf`).
    const placed = placementsOf({ placements: draw.rows ?? undefined }, () => worlds.of(draw.node!))
    // The surface record the source wears: this collection and everything it feeds hold it.
    const surface = sourceSurface(draw)
    const template = templates.pagesOf(primitive)
    noteCollected(draw)
    const transparent = pagesBlend(primitive, surface)
    const shape = templates.shapeOf(primitive, template)
    const distanceField =
      !!options.distanceFieldMeshes?.has(primitive.mesh) &&
      !(draw.casting & (SHADOWLESS_ROOT | NO_DISTANCE_FIELD_ROOT))
    const pages = createPageRecords(
      primitive,
      template,
      draw,
      surface,
      transparent,
      order,
      distanceField,
    )
    for (const rec of pages) into.allPages.push(rec)
    // One dependency list per object: every placement is installed after the same bundles.
    linkBundleDependencies(primitive, pages)
    const drawn: Drawn = { source: draw, primitive, surface, pages, shape }
    rootsOf(drawn, placed, into.roots)
    order++
    return primitive
  }
  return { add, worlds, primitiveOf, sources }
}

/** The records of `draws`, one source after another (`createCollector`). */
export function collectClusterPages(
  source: Object3D,
  draws: readonly DrawSource[],
  metadata: ClusterManifest,
  indices: Map<string, Uint32Array>,
  options: Parameters<typeof createCollector>[3] = {},
) {
  const collector = createCollector(source, metadata, indices, options)
  const into = collectedSink()
  const { roots, allPages } = into
  for (const draw of draws) collector.add(draw, into)
  const { worlds } = collector
  return {
    ...{ roots, allPages, worlds, blendOf, wears },
    collector,
    requests: indexPageRequests(allPages),
    prepared: metadata.primitives.reduce((n, p) => n + p.pages.length, 0),
  }
}
