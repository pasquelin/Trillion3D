import { EngineError } from '../../contracts/cache.ts'
import { IDENTITY_MATRIX4, copyMatrix4 } from '../matrix/matrix4.ts'
import { linkTransformNode } from './links.ts'
import { reserve } from './storage.ts'

/**
 * Engine transform hierarchy, data-oriented: a node is an index into flat arrays — parent, flags,
 * depth, position, quaternion `(x, y, z, w)`, scale — and two sixteen-number views, its local and
 * column-major world matrix (`localViews[i]`, `worldViews[i]`), allocated by block as the tree
 * grows and never moved: a matrix view is its node's for the life of the slot. Writes go through
 * the setters, which mark what they change and list the node once (`listed`): the frame pass
 * (`pass.ts`) brings the world matrices of the listed nodes and their subtrees up to date, each
 * node once, parents first, and nothing else. Each node lists its children, so a subtree walk never
 * reads outside the subtree (`links.ts`). A growth replaces the other arrays: a caller rereads
 * `tree.position` or `tree.flags` after an add.
 */
export interface TransformTree {
  /** How many nodes fit before it grows. */ capacity: number
  /** Indices served: every live node is under this bound. */
  end: number
  /** Each node's parent, −1 for a root. */ parent: Int32Array
  /** Each node's state bits. */ flags: Uint8Array
  /** Positions, three per node. */ position: Float64Array
  /** Rotations, four per node. */ quaternion: Float64Array
  /** Sizes, three per node. */ scale: Float64Array
  /** One view per node of its local matrix. */ localViews: Float64Array[]
  /** One view per node of its world matrix. */ worldViews: Float64Array[]
  /** World-matrix recalculation count, and the parent's at the last recalculation. */
  version: Uint32Array
  /** The parent's version each node last saw. */ seen: Uint32Array
  /** Freed indices, reused before extending `end`. */
  free: Int32Array
  /** How many freed indices wait. */ freeCount: number
  /** Each node's children as a linked list, −1 for none: a subtree walk costs the subtree. */
  firstChild: Int32Array
  /** Last child, where an attach links. */ lastChild: Int32Array
  /** Next child of the same parent. */ nextSibling: Int32Array
  /** Previous child of the same parent. */ previousSibling: Int32Array
  /** Each node's number of ancestors: the frame pass takes parents before children by it. */
  depth: Int32Array
  /** The nodes an input changed for since the last frame pass, each once (`NODE_LISTED`). */
  listed: Int32Array
  /** How many nodes `listed` holds. */ listedCount: number
  /** The listed nodes by depth, and the count of each depth: the frame pass's scratch, the
   *  second grown to the deepest listed node. */
  order: Int32Array
  /** How many listed nodes each depth holds, counted as running offsets into `order`. */
  buckets: Int32Array
  /** Ancestor chain buffer. */ chain: Int32Array
  /** Stamp buffer: what a traversal passes from a parent to its children. */ stamp: Uint32Array
  /** Current traversal number. */ call: number
  /** Told when the tree grows, with the position, rotation and scale stores it replaced: an
   *  owner holding views of them points them at the new ones (`world/object/objectPose.ts`). */
  grew?: (position: Float64Array, quaternion: Float64Array, scale: Float64Array) => void
}

/** `matrixAutoUpdate`: the local matrix is recomposed from position, rotation, scale. */
export const NODE_AUTO_UPDATE = 1
/** Pose or local matrix written since the last composition. */
export const NODE_TRS_DIRTY = 2
/** Local matrix or parent changed since the last world-matrix calculation. */
export const NODE_LOCAL_CHANGED = 4
/** The world-needs-update mark, which only the update rule reads. */
export const NODE_WORLD_NEEDS_UPDATE = 8
export const NODE_ALIVE = 16
/** Held in `listed` until the next frame pass, kept by a freed slot so a reuse lists it once. */
export const NODE_LISTED = 32

/** An empty hierarchy, ready for `capacity` nodes without growth. */
export function createTransformTree(capacity = 64): TransformTree {
  const tree = { capacity: 0, end: 0, freeCount: 0, listedCount: 0, call: 0 } as TransformTree
  tree.localViews = []
  tree.worldViews = []
  tree.buckets = new Int32Array(16)
  reserve(tree, Math.max(1, capacity))
  return tree
}

/** Throws if `node` is not a live node of the tree. */
export function assertNode(tree: TransformTree, node: number) {
  if (!(node >= 0 && node < tree.end && tree.flags[node] & NODE_ALIVE))
    throw new EngineError('UNKNOWN_TRANSFORM_NODE', `node ${node} absent from the hierarchy`, {
      node,
    })
}

/**
 * Sets `bits` on `node` and lists it for the next frame pass, once however many writes it takes:
 * what every input change does, a pose setter's or an owner's that writes the stores itself.
 */
export function markTransformNode(tree: TransformTree, node: number, bits = 0) {
  const flags = tree.flags[node]
  if (flags & NODE_LISTED) return void (tree.flags[node] = flags | bits)
  tree.flags[node] = flags | bits | NODE_LISTED
  tree.listed[tree.listedCount++] = node
}

/**
 * Adds a node under `parent` (`-1` for a root) and returns its index. The new node starts with zero
 * position, identity rotation, scale 1, identity matrices and automatic update.
 */
export function addTransformNode(tree: TransformTree, parent = -1) {
  if (parent !== -1) assertNode(tree, parent)
  let node: number
  if (tree.freeCount) node = tree.free[--tree.freeCount]
  else {
    if (tree.end === tree.capacity) reserve(tree, tree.capacity * 2)
    node = tree.end++
  }
  tree.parent[node] = -1
  tree.firstChild[node] = tree.lastChild[node] = -1
  linkTransformNode(tree, node, parent)
  // A freed slot keeps its place in `listed` alone: what a stale handle marked after the free goes.
  tree.flags[node] &= NODE_LISTED
  markTransformNode(tree, node, NODE_ALIVE | NODE_AUTO_UPDATE | NODE_LOCAL_CHANGED)
  setNodePosition(tree, node, 0, 0, 0)
  setNodeQuaternion(tree, node, 0, 0, 0, 1)
  setNodeScale(tree, node, 1, 1, 1)
  tree.localViews[node].set(IDENTITY_MATRIX4)
  tree.worldViews[node].set(IDENTITY_MATRIX4)
  tree.version[node] = 0
  tree.seen[node] = 0
  return node
}

/** Moves one node of a transform tree to `(x, y, z)` from its parent. */
export function setNodePosition(
  tree: TransformTree,
  node: number,
  x: number,
  y: number,
  z: number,
) {
  const p = tree.position,
    at = node * 3
  p[at] = x
  p[at + 1] = y
  p[at + 2] = z
  markTransformNode(tree, node, NODE_TRS_DIRTY)
}

/** Turns one node of a transform tree to the quaternion `(x, y, z, w)`. */
export function setNodeQuaternion(
  tree: TransformTree,
  node: number,
  x: number,
  y: number,
  z: number,
  w: number,
) {
  const q = tree.quaternion,
    at = node * 4
  q[at] = x
  q[at + 1] = y
  q[at + 2] = z
  q[at + 3] = w
  markTransformNode(tree, node, NODE_TRS_DIRTY)
}

/** Stretches one node of a transform tree by `(x, y, z)`. */
export function setNodeScale(tree: TransformTree, node: number, x: number, y: number, z: number) {
  const s = tree.scale,
    at = node * 3
  s[at] = x
  s[at + 1] = y
  s[at + 2] = z
  markTransformNode(tree, node, NODE_TRS_DIRTY)
}

/**
 * Sets the local matrix. Under automatic update, the next update recomposes it from
 * position, rotation and scale, as a whole-matrix write does.
 */
export function setNodeLocalMatrix(tree: TransformTree, node: number, m: ArrayLike<number>) {
  copyMatrix4(tree.localViews[node], m)
  markTransformNode(tree, node, NODE_LOCAL_CHANGED | NODE_TRS_DIRTY)
}

/**
 * `matrixAutoUpdate`. Nothing else to mark when re-enabling it: a local matrix that differs from its
 * composition already carries `NODE_TRS_DIRTY`, set by `setNodeLocalMatrix` or by a pose setter.
 * Either way the node is listed: how its local matrix is made changed.
 */
export function setNodeAutoUpdate(tree: TransformTree, node: number, auto: boolean) {
  markTransformNode(tree, node)
  if (auto) tree.flags[node] |= NODE_AUTO_UPDATE
  else tree.flags[node] &= ~NODE_AUTO_UPDATE
}
