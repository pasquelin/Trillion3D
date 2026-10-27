/**
 * A cell file of the world partition (`scene-cell-*.json`,
 * `packages/asset-compiler-rust/src/compiler/tables/partition.rs`): the nodes it places, each under
 * a core node or the scene root, read by distance to the camera (`tablePartition.ts`).
 */
import { EngineError } from '../../contracts/cache.ts'
import type { DrawDistanceSettings } from '../../contracts/objectOptions.ts'
import { parseSourceRank } from './sourceRank.ts'

/** The version of the cell files this runtime reads: 3 names an instanced skinned object's track
 *  (`track`) and the core node an animated object's row is drawn from (`source`), 4 the source node
 *  every row draws (`sourceNode`), which `physics.json` names a body or a collider by. */
const CELL_VERSION = 4

/** The distances an object is drawn at, from the eye, in the scene's units (`drawDistance` of the
 *  job's object settings): not drawn where the sphere of its bounds is wholly nearer than `min` or
 *  wholly farther than `max` — its bounds' centre, for one instance of an instanced mesh
 *  (`perInstance`) —; an object that names no distance carries none. */
export type TableDrawDistance = Required<DrawDistanceSettings>

/** The error and the LOD ball of the group that replaces the root of a primitive of an assembly's
 *  part, in the space of that primitive: `[error, x, y, z, radius]`. The cut opens an instance of
 *  the assembly only while that error shows at the ball's distance; far away the group's own
 *  clusters, in the assembly's primitive, draw in its stead. */
export type TableRootParent = readonly [number, number, number, number, number]

/** One node a cell places: the core node it hangs under (`null`, the scene), its mesh, and its
 *  LOCAL pose exactly as declared — a matrix, or translation, rotation and scale, each `null` or
 *  left out when silent — which the runtime composes the way it composes every other pose. An
 *  instanced skinned object hangs under its skin's frame at no pose and names the track of the
 *  scene's animation banks it plays (`track`); an animated object of the core — skinned, morphed or
 *  moved by a clip — is drawn by a row under its own node at no pose, that node's host mesh its
 *  animation source (`source`). */
export interface CellNode {
  /** The source node it draws, by its rank in the input scene, as eight lowercase hexadecimal
   *  digits (`TableNode.sourceNode`): what the physics names a body or a collider by. */
  sourceNode: string
  /** Rank of its parent in the core node table; `null` for a scene root. */
  parent: number | null
  /** The mesh it places. */
  mesh: number
  /** Its local matrix, column-major. */
  matrix?: readonly number[] | null
  /** Where it stands. */
  translation?: readonly number[] | null
  /** How it is turned, as a quaternion. */
  rotation?: readonly number[] | null
  /** How it is stretched. */
  scale?: readonly number[] | null
  /** The item of the scene's animation banks the row plays (`./animationBanks.ts`). */
  track?: number
  /** The row is drawn from its parent's own host mesh: its skeleton and morph weights move it. */
  source?: true
  /** The distances the row is drawn at, left out for an object that names none. */
  drawDistance?: TableDrawDistance
  /** The row is drawn by a view's primed depth (`farField` of the job's object settings). */
  farField?: true
  /** An instance of an assembly (`rootParents` of the node table): per primitive of its mesh, the
   *  group that replaces its root, `null` for a primitive none replaces; left out for any other
   *  node, so a cell with none is the bytes it was. */
  rootParents?: readonly (TableRootParent | null)[]
}

/** The nodes of a cell file, read from `url`, or a named refusal. */
export function assertCellNodes(value: unknown, url = 'scene cell'): readonly CellNode[] {
  const cell = value as { version?: number; nodes?: CellNode[] } | null
  if (!cell || cell.version !== CELL_VERSION || !Array.isArray(cell.nodes))
    throw new EngineError(
      'INVALID_SCENE_TABLES',
      `${url} is not a version ${CELL_VERSION} node list`,
      { version: cell?.version ?? null },
    )
  cell.nodes.forEach((node, row) => {
    if (parseSourceRank((node as Partial<CellNode> | null)?.sourceNode) === undefined)
      throw new EngineError(
        'INVALID_SCENE_TABLES',
        `${url} names a node whose sourceNode is not eight lowercase hexadecimal digits`,
        { row },
      )
  })
  return cell.nodes
}
