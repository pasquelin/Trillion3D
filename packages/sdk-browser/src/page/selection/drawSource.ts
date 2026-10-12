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
import type { HostAttributes, HostMaterials, HostMesh } from '../../host/resources.ts'
import type { GraphSurface } from '../../host/graph/surface.ts'
import { objects } from './helpers.ts'
import type { PlacementRows } from '../../placement/rows.ts'

/** The association a manifest gave a source: its mesh and primitive ranks, the rows that place it. */
export type DrawRanks = {
  /** Its mesh rank in the manifest. */
  meshes?: number
  /** Its primitive rank inside that mesh. */
  primitives?: number
  /** The rows that place it, one root each. */
  placements?: PlacementRows
}

/** What a graph's loader tells of its drawn nodes: each node's association. */
export type DrawAssociations = Map<Object3D, DrawRanks>

/** What a session draws, source by source: its geometry, the declaration its surface is read from,
 *  where it is placed and its ranks in the manifest. */
export type DrawSource = {
  /** The triangles it draws. */
  readonly geometry: Geometry
  /** The named vertex attributes of that geometry: what its GPU buffers are keyed by. */
  readonly attributes: HostAttributes
  /** The host rewrites the vertices in place: the engine reads them as floats. */
  readonly dynamic: boolean
  /** What the surface is read from, one declaration or one per geometry group. */
  readonly declaration: HostMaterials
  /** The node the host watches for this source and poses it by; its chain decides hiding.
   *  Absent where rows place it: their owner writes the pose and the flags. */
  readonly node?: HostMesh
  /** Whether it casts shadows. */
  readonly castShadow: boolean
  /** Whether the host lets it be skipped outside the view. */
  readonly frustumCulled: boolean
  /** The source wears `surface` from now on, in place of its declaration. */
  wear(surface: GraphSurface): void
  /** The instance rows that place it, one root each, parked rows included. */
  readonly rows?: PlacementRows | null
  /** Its mesh rank in the manifest. */
  readonly mesh?: number
  /** Its primitive rank inside that mesh. */
  readonly primitives?: number
}

class MeshSource implements DrawSource {
  readonly node: HostMesh
  ranks: DrawRanks | undefined
  constructor(node: HostMesh) {
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
  wear(surface: GraphSurface) {
    this.node.material = surface
  }
  get castShadow() {
    return this.node.castShadow
  }
  get frustumCulled() {
    return this.node.frustumCulled
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
}

const sources = new WeakMap<HostMesh, MeshSource>()

/** The source of a drawn graph node, one per node however many records name it; `ranks` is the
 *  association the manifest gave it, kept when given. */
export function drawSourceOf(mesh: HostMesh, ranks?: DrawRanks): DrawSource {
  let source = sources.get(mesh)
  if (!source) sources.set(mesh, (source = new MeshSource(mesh)))
  if (ranks) source.ranks = ranks
  return source
}

/** The sources of a graph's drawn nodes, in the graph's order, each with its association. */
export const graphDraws = (root: Object3D, associations: ReadonlyMap<Object3D, DrawRanks>) =>
  objects(root).map((mesh) => drawSourceOf(mesh, associations.get(mesh)))
