/**
 * WHAT A PAGE IS DRAWN FROM: the one record the engine reads of the thing a primitive belongs to —
 * its geometry, whether the host rewrites it, the declaration its surface is read from, the node
 * whose visibility and pose it follows, the instance rows that place it. A record of the selection
 * holds a source and nothing else of the host's graph.
 *
 * A session draws a list of sources (`EngineContext.draws`): a graph's drawn nodes through
 * `graphDraws`, a world's batches and models through the sources it keeps itself.
 */
import type { Geometry } from '../../../../sdk-core/src/world/geometry/geometry.ts'
import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'
import type { PageSurface } from '../pages/surface.ts'
import { meshes } from '../../scene/meshes.ts'
import { nodeCasting } from '../../visibility/shader/castingMark.ts'
import type { PlacementRows } from '../../placement/rows/rows.ts'
import type { DrawDistance, RootParent } from './types.ts'
import type { TableRootParent } from '../../../../sdk-core/src/scene/core/tableCell.ts'
import type { PageMaterials, PageMesh } from '../pages/pageMesh.ts'

/** The association a manifest gave a source: its mesh and primitive ranks, the rows that place it. */
export type DrawRanks = {
  /** Its mesh rank in the manifest. */
  meshes?: number
  /** Its primitive rank inside that mesh. */
  primitives?: number
  /** The rows that place it, one root each. */
  placements?: PlacementRows
  /** A cloth draws it (`drawnTwoSided`): every surface it wears is drawn on both faces. */
  twoSided?: boolean
}

/** What a graph's loader tells of its drawn nodes: each node's association. */
export type DrawAssociations = Map<Object3D, DrawRanks>

/** What a session draws, source by source: its geometry, the declaration its surface is read from,
 *  where it is placed and its ranks in the manifest. */
export type DrawSource = {
  /** The triangles it draws. */
  readonly geometry: Geometry
  /** The named vertex attributes of that geometry: what its GPU buffers are keyed by. */
  readonly attributes: Geometry['attributes']
  /** The host rewrites the vertices in place: the engine reads them as floats. */
  readonly dynamic: boolean
  /** What the surface is read from, one declaration or one per geometry group. */
  readonly declaration: PageMaterials
  /** The node the host watches for this source and poses it by; its chain decides hiding.
   *  Absent where rows place it: their owner writes the pose and the flags. */
  readonly node?: PageMesh
  /** How it casts, as its node says (`nodeCasting`): no shadow, far shadows. */
  readonly casting: number
  /** The distances a node placed at its own world is drawn at (`holdDrawDistance`); a row says
   *  its own (`PlacementRows.drawDistance`). Absent: at every distance. */
  readonly drawDistance?: DrawDistance
  /** The group that replaces its root, for a node placed at its own world that is an instance of an
   *  assembly (`holdRootParents`); a row says its own (`PlacementRows.rootParent`). Absent
   *  otherwise. */
  readonly rootParent?: RootParent
  /** Whether the host lets it be skipped outside the view. */
  /** The source wears `surface` from now on, in place of its declaration. */
  wear(surface: PageSurface): void
  /** The instance rows that place it, one root each, parked rows included. */
  readonly rows?: PlacementRows | null
  /** Its mesh rank in the manifest. */
  readonly mesh?: number
  /** Its primitive rank inside that mesh. */
  readonly primitives?: number
  /** A cloth draws it, as its manifest says: the surfaces it is given are drawn on both faces. */
  readonly twoSided?: boolean
}

class MeshSource implements DrawSource {
  readonly node: PageMesh
  ranks: DrawRanks | undefined
  constructor(node: PageMesh) {
    this.node = node
  }
  get geometry() {
    return this.node.geometry
  }
  get attributes() {
    return this.node.geometry.attributes
  }
  get dynamic() {
    return this.node.geometry.usage === 'dynamic'
  }
  get declaration() {
    return this.node.material
  }
  wear(surface: PageSurface) {
    this.node.material = surface
  }
  get casting() {
    return nodeCasting(this.node)
  }
  get drawDistance() {
    return drawDistances.get(this.node)
  }
  get rootParent() {
    return rootParents.get(this.node)?.[this.primitives ?? 0] ?? undefined
  }
  get rows() {
    return this.ranks?.placements
  }
  get mesh() {
    return this.ranks?.meshes
  }
  get primitives() {
    return this.ranks?.primitives
  }
  get twoSided() {
    return this.ranks?.twoSided === true
  }
}

const sources = new WeakMap<PageMesh, MeshSource>()

/** The distances each drawn mesh of a prepared scene's core is drawn at, from its node table
 *  (`../../scene/host/prepared/graph.ts`): engine data no host object carries. */
const drawDistances = new WeakMap<PageMesh, DrawDistance>()

/** The group that replaces the root of each primitive of each drawn mesh of a prepared scene's core
 *  that is an instance of an assembly, by the primitive's rank in its mesh (`graph.ts`). */
const rootParents = new WeakMap<PageMesh, readonly (RootParent | null)[]>()

/** Mesh `mesh` is an instance of an assembly: the group above the root of each primitive of its
 *  part, `null` for one none replaces (`TableNode.rootParents`). */
export const holdRootParents = (mesh: PageMesh, parents: readonly (TableRootParent | null)[]) =>
  void rootParents.set(
    mesh,
    parents.map((p) => p && { error: p[0], sphere: [p[1], p[2], p[3], p[4]] as const }),
  )

/** Mesh `mesh` is drawn at `distance` from now on. */
export const holdDrawDistance = (mesh: PageMesh, distance: DrawDistance) =>
  void drawDistances.set(mesh, distance)

/** The source of a drawn graph node, one per node however many records name it; `ranks` is the
 *  association the manifest gave it, kept when given. */
export function drawSourceOf(mesh: PageMesh, ranks?: DrawRanks): DrawSource {
  let source = sources.get(mesh)
  if (!source) sources.set(mesh, (source = new MeshSource(mesh)))
  if (ranks) source.ranks = ranks
  return source
}

/** The sources of a graph's drawn nodes, in the graph's order, each with its association. */
export const graphDraws = (root: Object3D, associations: ReadonlyMap<Object3D, DrawRanks>) =>
  meshes(root).map((mesh) => drawSourceOf(mesh, associations.get(mesh)))
