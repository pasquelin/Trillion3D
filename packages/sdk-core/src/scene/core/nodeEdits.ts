import * as structure from '../../world/transform-tree/structure.ts'
import {
  NODE_AUTO_UPDATE,
  setNodeAutoUpdate as setAutoUpdate,
  setNodeLocalMatrix as setLocalMatrix,
  type TransformTree,
} from '../../world/transform-tree/transformTree.ts'

/** How many times any scene node was renamed or changed parent since the page loaded: an answer
 *  found by walking names — the engine's name index of a prepared scene — holds while it stands. */
let edits = 0
/**
 * The slots of the nodes a field no pose hook hears was written on through the engine — every scene
 * node a slot of the page's one tree (`world/object/objectSpace.ts`), none held —, in order: a
 * visibility changed, a shadow flag, the `matrix` getter, a local matrix set, its automatic
 * update, a parent, a light's numbers or colours (through their methods), a matrix storage of its
 * own taken. Numbers written straight into an array a caller kept (`matrix.elements`) or into a
 * colour's `r`, `g`, `b` are noted once announced — `matrixWorldNeedsUpdate = true`, a light's
 * `needsUpdate = true` —. A reader keeps the count it read up to (`nodeWrites`) and reads the nodes
 * written since (`nodesWrittenSince`), never the scene: the scene watch reads those alone
 * (`host/scene/watch.ts`). Bounded: a ring of `JOURNAL_CAP` slots, and a reader left more than
 * that behind reads every node it watches once.
 */
const JOURNAL_CAP = 4096
const journal = new Int32Array(JOURNAL_CAP)
let journalCount = 0

/** The current count: compare it with the one an answer was built under. */
export const objectEdits = () => edits

/** A name or a parent changed. */
export const noteObjectEdit = () => void edits++

/** How many node field writes no pose hook hears were noted since the page loaded. */
export const nodeWrites = () => journalCount

/** A field no pose hook hears was written on `node`: its slot noted, no reference to it held. */
export const noteNodeWrite = (node: { readonly index: number }) => noteSlotWrite(node.index)

/** Whether a reader is taking in a write it already read (`unnoted`): nothing is noted then. */
let muted = false

/** `noteNodeWrite` of the node at `slot` of the page's tree. */
function noteSlotWrite(slot: number) {
  if (!muted) journal[journalCount++ & (JOURNAL_CAP - 1)] = slot
}

/** Runs `take`, which takes into the tree a write its caller already read — a matrix the scene
 *  watch compared —, noting nothing: the write is not read a second time. */
export function unnoted(take: () => void) {
  muted = true
  try {
    take()
  } finally {
    muted = false
  }
}

/** The slot of each node written from count `from` up to `to` (`nodeWrites`, the count as the
 *  visit starts by default), in order, a node written twice twice: a write the visit itself makes
 *  is read from `to` on, the next time; false — the reader reads every node it watches — once the
 *  ring no longer holds an entry not yet read, the visit's own writes overwriting it included. */
export function nodesWrittenSince(from: number, visit: (slot: number) => void, to = journalCount) {
  for (let i = from; i < to; i++) {
    if (journalCount - i > JOURNAL_CAP) return false
    visit(journal[i & (JOURNAL_CAP - 1)])
  }
  return true
}

/** `reparentTransformNode`, counted: the one way a scene node changes parent. */
export function reparentTransformNode(tree: TransformTree, node: number, parent: number) {
  structure.reparentTransformNode(tree, node, parent)
  noteObjectEdit()
  noteSlotWrite(node)
}

/** `removeTransformNode`, counted: a freed node leaves its parent. */
export function removeTransformNode(tree: TransformTree, node: number) {
  structure.removeTransformNode(tree, node)
  noteObjectEdit()
  noteSlotWrite(node)
}

/** `setNodeLocalMatrix`, counted: a scene node's matrix set by hand. */
export function setNodeLocalMatrix(tree: TransformTree, node: number, m: ArrayLike<number>) {
  setLocalMatrix(tree, node, m)
  noteSlotWrite(node)
}

/** `setNodeAutoUpdate`, counted when the flag flips: whether a scene node's matrix follows its
 *  pose. */
export function setNodeAutoUpdate(tree: TransformTree, node: number, auto: boolean) {
  const was = (tree.flags[node] & NODE_AUTO_UPDATE) !== 0
  setAutoUpdate(tree, node, auto)
  if (was !== auto) noteSlotWrite(node)
}
