import { sameElements } from '../../../../math/src/matrix/matrixElements.ts'
import { copyMatrix4 } from '../../../../math/src/matrix/matrix4.ts'
import { unnoted } from '../../../../sdk-core/src/scene/core/nodeEdits.ts'
import { isLightNode } from '../graph/kinds.ts'
import type { Light } from '../../../../sdk-core/src/world/light/light.ts'
import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'

/** What a watch reports of a read: nothing, a value moved, or the set of read objects changed. */
export type WatchVerdict = 0 | 'moved' | 'reshaped'

/** What a comparison found of a node (`scan`), as bits: shown, hidden or set to cast or not; its
 *  pose moved — its matrix mode, or its matrix set by hand —; a value moved, those two or another;
 *  its parent changed or it was destroyed, the watched set to be rebuilt. */
export const SCAN_FLIPPED = 1,
  SCAN_POSED = 2,
  SCAN_RESHAPED = 8
const SCAN_MOVED = 4

/** The watch's verdict of a comparison's bits. */
export const verdictOf = (found: number): WatchVerdict =>
  found & SCAN_RESHAPED ? 'reshaped' : found & SCAN_MOVED ? 'moved' : 0

/** Numbers of a light the engines consume: colour, intensity, range, decay, cone, ground colour. */
const LIGHT_VALUES = 11
const scratch = new Float64Array(LIGHT_VALUES)
const finite = (value: number) => (Number.isFinite(value) ? value : 0)

/**
 * What a watched node holds outside its hooked pose, as last read. These are the node's own
 * data fields — the host writes them itself on its walk — so no hook may sit on them
 * without dropping the node into dictionary mode: they are compared when the engine's write
 * count moved (`watch.ts`), a few values per node, and a matrix set by hand is compared whole
 * while the node is frozen.
 */
export interface NodeState {
  node: Object3D
  visible: boolean
  castShadow: boolean
  parent: Object3D | null
  auto: boolean
  matrix: Float64Array | null
  /** A light's numbers as last read; its target, read-only on the core's `Light`, never changes. */
  light: Float64Array | null
  /** The read of the watch it was last compared in: once a read whatever its writes. */
  read: number
}

function lightValues(light: Light, into: Float64Array) {
  const colour = light.color
  into[0] = colour.r
  into[1] = colour.g
  into[2] = colour.b
  into[3] = light.intensity
  into[4] = finite(light.distance)
  into[5] = finite(light.decay)
  into[6] = finite(light.angle)
  into[7] = finite(light.penumbra)
  into[8] = light.groundColor.r
  into[9] = light.groundColor.g
  into[10] = light.groundColor.b
}

/** A light's numbers as they stand. */
function lightState(light: Light) {
  const values = new Float64Array(LIGHT_VALUES)
  lightValues(light, values)
  return values
}

/** The node as it stands: the first read after it announces nothing. */
export function snapshot(node: Object3D): NodeState {
  const lit = isLightNode(node) ? lightState(node) : null
  return {
    node,
    visible: node.visible,
    castShadow: node.castShadow,
    parent: node.parent,
    auto: node.matrixAutoUpdate,
    matrix: node.matrixAutoUpdate ? null : Float64Array.from(node._matrixElements),
    light: lit,
    read: -1,
  }
}

function scanLight(light: Light, held: Float64Array): boolean {
  // A colour replaced as a whole is read through the new object: its numbers are what count.
  lightValues(light, scratch)
  let moved = false
  for (let k = 0; k < LIGHT_VALUES; k++)
    if (held[k] !== scratch[k]) {
      held[k] = scratch[k]
      moved = true
    }
  return moved
}

/** Compares the node to its state and takes what moved (`SCAN_*` bits): what the host's walk
 *  writes is read back as it stands, so a write of the value already held moves nothing. */
export function scan(state: NodeState): number {
  // A node destroyed leaves the watched set: it is to be rebuilt.
  if (!state.node._alive) return SCAN_RESHAPED
  const node = state.node,
    // One read each, into a local: `parent` and `visible` are getters that check the node is
    // still alive, and this walk runs on every watched node once the write count moved.
    parent = node.parent,
    visible = node.visible,
    castShadow = node.castShadow,
    auto = node.matrixAutoUpdate
  let found = 0
  // A reparented node changes its ancestor chain: the watched set is reshaped.
  if (parent !== state.parent) found |= SCAN_RESHAPED
  state.parent = parent
  if (visible !== state.visible || castShadow !== state.castShadow) found |= SCAN_FLIPPED
  state.visible = visible
  state.castShadow = castShadow
  if (auto !== state.auto) {
    // Frozen from now on: the matrix it holds is the pose, whatever wrote it.
    state.auto = auto
    state.matrix = auto ? null : Float64Array.from(node._matrixElements)
    found |= SCAN_POSED
  } else if (state.matrix && !sameElements(state.matrix, node._matrixElements)) {
    // Read without counting as a write; numbers written through the getter, or announced after
    // a write behind it, are taken into the tree here — the write already read, noted no more.
    copyMatrix4(state.matrix, node._matrixElements)
    unnoted(() => node._matrixMoved())
    found |= SCAN_POSED
  }
  if (state.light && isLightNode(node) && scanLight(node, state.light)) found |= SCAN_MOVED
  return found & (SCAN_FLIPPED | SCAN_POSED) ? found | SCAN_MOVED : found
}

/** The engine posed `state`'s node itself, its matrix written and its update cut
 *  (`../world/moveByName.ts`): what the comparison holds of it follows, so the engine's own
 *  pose is not read back as the host's. */
export function adoptPose(state: NodeState) {
  const node = state.node
  state.auto = node.matrixAutoUpdate
  if (state.auto) state.matrix = null
  else if (state.matrix) copyMatrix4(state.matrix, node._matrixElements)
  else state.matrix = Float64Array.from(node._matrixElements)
}
