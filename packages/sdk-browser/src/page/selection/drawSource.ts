/**
 * WHAT A PAGE IS DRAWN FROM: the one record the engine reads of the thing a primitive belongs to —
 * its vertex attributes, whether the host rewrites them, the declaration its surface is read from,
 * the node whose visibility and pose it follows, whether it casts. A record of the selection holds
 * a source and nothing else of the host's graph.
 */
import type { HostAttributes, HostMaterials, HostMesh } from '../../host/resources.ts'

/** The rank a source was given in the session's manifest: its mesh and its primitive. */
export type DrawRanks = { meshes?: number; primitives?: number }

export type DrawSource = {
  readonly attributes: HostAttributes
  /** The host rewrites the vertices in place: the engine reads them as floats. */
  readonly dynamic: boolean
  /** What the surface is read from, one declaration or one per geometry group. */
  readonly declaration: HostMaterials
  /** The node the host watches for this source; its chain decides hiding and pose. */
  readonly node?: HostMesh
  readonly castShadow: boolean
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
  get attributes() {
    return this.node.geometry.attributes
  }
  get dynamic() {
    return this.node.geometry.usage === 'dynamic'
  }
  get declaration() {
    return this.node.material
  }
  get castShadow() {
    return this.node.castShadow
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
