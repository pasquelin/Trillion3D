import * as structure from '../../world/transform-tree/structure.ts'
import {
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
 * (`host/scene/watch.ts`). Bounded: past `JOURNAL_CAP` nodes the journal starts over, and a reader
 * left behind its start, or meeting a write that named no node, reads every node it watches once.
 */
const JOURNAL_CAP = 4096
const journal = new Int32Array(JOURNAL_CAP)
let journalBase = 0,
  journalLength = 0

/** The current count: compare it with the one an answer was built under. */
export const objectEdits = () => edits

/** A name or a parent changed. */
export const noteObjectEdit = () => void edits++

/** How many node field writes no pose hook hears were noted since the page loaded. */
export const nodeWrites = () => journalBase + journalLength

/** A field no pose hook hears was written on `node` — its slot noted, no reference to it held —,
 *  or on a node it does not name: a reader then reads every node it watches. */
export const noteNodeWrite = (node?: { readonly index: number }) =>
  noteSlotWrite(node ? node.index : -1)

/** `noteNodeWrite` of the node at `slot` of the page's tree, -1 for none named. */
function noteSlotWrite(slot: number) {
  if (journalLength === JOURNAL_CAP) {
    journalBase += journalLength
    journalLength = 0
  }
  journal[journalLength++] = slot
}

/** The slot of each node written from count `from` on (`nodeWrites`), in order, a node written
 *  twice twice; false, nothing more visited, when the journal no longer holds them all or a write
 *  named no node. */
export function nodesWrittenSince(from: number, visit: (slot: number) => void) {
  if (from < journalBase) return false
  for (let i = from - journalBase; i < journalLength; i++) {
    if (journal[i] < 0) return false
    visit(journal[i])
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

/** `setNodeAutoUpdate`, counted: whether a scene node's matrix follows its pose. */
export function setNodeAutoUpdate(tree: TransformTree, node: number, auto: boolean) {
  setAutoUpdate(tree, node, auto)
  noteSlotWrite(node)
}
