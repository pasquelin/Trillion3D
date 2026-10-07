import {
  BOX_VALUES,
  boxTransform,
  type ClusterManifest,
  type Primitive,
} from '../../../../sdk-core/src/index.ts'
import { meshSurface, type PageSurface } from '../surface.ts'
import { spriteMark, withShadowless } from '../../visibility/shader/spriteWgsl.ts'
import type { BlendCopy } from '../../cluster/blendCopyContract.ts'
import { createBlendCopyRecord } from '../../cluster/blendCopyRecord.ts'
import { objects } from './helpers.ts'
import { primitiveFinder } from '../../scene/primitiveLookup.ts'
import { createPrimitiveTemplates } from './template.ts'
import { createPageRecords } from './collectRecords.ts'
import { indexPageRequests } from './requests.ts'
import { linkBundleDependencies } from './bundleDependencies.ts'
import { hostWorldPlacements } from '../../host/world/placements.ts'
import type { PageRec, ClusterRoot } from './types.ts'
import { placementsOf, type Placed } from '../../placement/roots.ts'
import type { HostMesh } from '../../host/resources.ts'
import { rowShadowless, type PlacementRows } from '../../placement/rows.ts'
import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'
import { blendMoves, isAssignment, type AlphaChange } from '../../placement/engineSceneUpdates.ts'
/** Whether a primitive's pages are drawn blended at the open. A material moved between draw
 *  classes later puts them in the family of its new class alone (`reassignBlend`): its pages are
 *  cut again on that class's grid (`classPages.ts`), as a fresh session of it compiles them. */
const pagesBlend = (primitive: { pass?: string }, surface: { transparent: boolean }) =>
  primitive.pass === 'clustered-blend' || surface.transparent
/** The meshes whose pages a collection drew, whichever read them: a resource mounted in place
 *  (#572) is its own collection, and moves class with the open's records (#837). */
const collected = new WeakSet<object>()

/** One primitive drawn by pages: its source mesh, the surface it wears, its records and shape —
 *  shared by every placement. */
type Drawn = {
  mesh: HostMesh
  primitive: Primitive
  surface: PageSurface
  pages: PageRec[]
  shape: ReturnType<ReturnType<typeof createPrimitiveTemplates>['shapeOf']>
}

/** One blended draw per placement, sharing the mesh's geometry and surface: each is ordered by its
 *  own depth, and a row's copy is skipped while the row is parked. */
function blendCopiesOf(
  { mesh, primitive, surface }: Omit<Drawn, 'pages' | 'shape'>,
  placed: readonly Placed[],
  order: number,
  copies: BlendCopy[],
) {
  for (const { world, placement } of placed) {
    const copy = createBlendCopyRecord(mesh, order, world, surface, placement)
    copy.deformation = primitive.deformation
    copies.push(copy)
  }
}

/** Nothing replaces these: the coarsest complete cover, resident, the cut's fallback. A cover page
 *  already taken is not taken again, so the bootstrap holds each record once however many
 *  placements of its primitive the scene carries (#1235). */
function coverBootstrap({ pages, shape }: Drawn, covered: Set<PageRec>, bootstrap: PageRec[]) {
  for (const root of shape.structure?.roots ?? []) {
    const cover = pages[root]
    if (!covered.has(cover)) {
      covered.add(cover)
      bootstrap.push(cover)
    }
  }
}

/** One root per placement of a primitive drawn by pages: its world and box, the primitive's
 *  nodes, bounds and links shared by all. */
function rootsOf(drawn: Drawn, placed: readonly Placed[], roots: ClusterRoot<PageRec>[]) {
  const { mesh, primitive, surface, pages, shape } = drawn,
    { structure, culling } = shape
  const sharedCulling = culling && { ...culling, bounds: shape.bounds!, links: shape.links }
  for (const { world, parked, placement } of placed) {
    const worldBox = new Float64Array(BOX_VALUES)
    boxTransform(worldBox, 0, shape.local, 0, world.elements)
    roots.push({
      world,
      mesh: primitive.mesh,
      pages,
      // Nodes, their bounds and their links are the primitive's, shared by all its placements.
      culling: sharedCulling,
      worldBox,
      localBox: shape.local,
      structure,
      // Every record has the manifest's `min` and `max` (the page contract): none is checked.
      boxes: true,
      parked,
      placement,
      // How far its GPU deformation can move a vertex, measured by the compiler (#357).
      ...(primitive.deformation ? { deformation: primitive.deformation } : {}),
      // A row says whether its placement casts; a node placed at its own world, its mesh.
      mark:
        withShadowless(
          spriteMark(surface),
          placement ? rowShadowless(placement) : !mesh.castShadow,
        ) || undefined,
    })
  }
}

/** Whether `alpha` moves the surface a record wears, or gives it another. */
const wears = ({ sourceMesh: mesh }: PageRec, alpha: AlphaChange) =>
  !!mesh &&
  (isAssignment(alpha) ? alpha.meshes.has(mesh) : alpha.surfaces.includes(mesh.material as object))

/** Whether a record is drawn blended once `alpha` moved its surfaces, before or after they are
 *  written: the family a collection gives the class `alpha.to`, or the one it has. */
const blendOf = (rec: PageRec, alpha: AlphaChange) =>
  wears(rec, alpha) && collected.has(rec.sourceMesh!) ? alpha.to === 'blend' : rec.transparent

/** The open's assignment, run again once a material moved into or out of blended inside the
 *  session (#846): each record takes `blendOf`; true when one moved. */
function reassignBlend(records: readonly PageRec[], alpha: AlphaChange) {
  let moved = false
  for (const rec of blendMoves(alpha) ? records : []) {
    const transparent = blendOf(rec, alpha)
    moved ||= transparent !== rec.transparent
    rec.transparent = transparent
  }
  return moved
}

export function collectClusterPages(
  source: Object3D,
  metadata: ClusterManifest,
  indices: Map<string, Uint32Array>,
  associations: Map<Object3D, { meshes?: number; primitives?: number; placements?: PlacementRows }>,
  options: {
    allowMissing?: boolean
    /** Leaves out a mesh placed by rows whose primitive is not read yet, mounted later (#751). */
    pendingPlaced?: boolean
  } = {},
) {
  const worlds = hostWorldPlacements(source)
  const roots: Array<ClusterRoot<PageRec>> = [],
    allPages: PageRec[] = [],
    blendCopies: BlendCopy[] = [],
    bootstrap: PageRec[] = []
  const primitiveOf = primitiveFinder(metadata.primitives)
  // One template per source object, shared by all its placements: the DAG shape, its error
  // bands and cluster identities depend on no world matrix.
  const templates = createPrimitiveTemplates(indices, options.allowMissing === true)
  const covered = new Set<PageRec>()
  let order = 0
  for (const mesh of objects(source)) {
    const association = associations.get(mesh)
    const primitive = primitiveOf(association)
    if (!primitive && options.pendingPlaced && association?.placements) continue
    if (!primitive) throw new Error(`Missing primitive association: ${mesh.name}`)
    // One root per placement: the node's pose, or each row its association carries (`placementRoots`).
    const placed = placementsOf(association, () => worlds.of(mesh))
    // The surface the declaration wears, read at the boundary into the engine's own record:
    // from here on this collection and everything it feeds hold records, not host materials.
    const surface = meshSurface(mesh)
    if (primitive.pass === 'shared-blend' || surface.transmission > 0) {
      blendCopiesOf({ mesh, primitive, surface }, placed, order++, blendCopies)
      continue
    }
    const template = templates.pagesOf(primitive)
    collected.add(mesh)
    const transparent = pagesBlend(primitive, surface)
    const shape = templates.shapeOf(primitive, template)
    // ONE record per primitive page (#1235), shared by every placement of this source object: its
    // world, its row and its packed rank are the layout's, never a field here.
    const pages = createPageRecords(primitive, template, mesh, surface, transparent, order)
    for (const rec of pages) allPages.push(rec)
    // One dependency list per object: every placement is installed after the same bundles.
    linkBundleDependencies(primitive, pages)
    const drawn: Drawn = { mesh, primitive, surface, pages, shape }
    coverBootstrap(drawn, covered, bootstrap)
    rootsOf(drawn, placed, roots)
    order++
  }
  return {
    ...{ roots, allPages, worlds, blendCopies, blendOf, wears, reassignBlend, bootstrap },
    requestCount: indexPageRequests(allPages),
    prepared: metadata.primitives.reduce((n, p) => n + p.pages.length, 0),
  }
}
