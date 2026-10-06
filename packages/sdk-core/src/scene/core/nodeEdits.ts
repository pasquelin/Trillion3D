import * as structure from '../../math/transform-tree/structure.ts'
import {
  setNodeAutoUpdate as setAutoUpdate,
  setNodeLocalMatrix as setLocalMatrix,
  type TransformTree,
} from '../../math/transform-tree/transformTree.ts'

/** How many times any scene node was renamed or changed parent since the page loaded: an answer
 *  found by walking names — the engine's name index of a prepared scene — holds while it stands. */
let edits = 0
/** How many times a node field no pose hook hears was written through the engine: a visibility
 *  changed, a shadow flag, the `matrix` getter, a local matrix set, its automatic update, a parent,
 *  a light's numbers or colours (through their methods), a matrix storage of its own taken. Numbers
 *  written straight into an array a caller kept (`matrix.elements`) or into a colour's `r`, `g`,
 *  `b` are counted once announced — `matrixWorldNeedsUpdate = true`, a light's `needsUpdate =
 *  true` —: the scene watch reads nothing while the count stands (`host/scene/watch.ts`). */
let writes = 0

/** The current count: compare it with the one an answer was built under. */
export const objectEdits = () => edits

/** A name or a parent changed. */
export const noteObjectEdit = () => void edits++

/** The count of node field writes no pose hook hears: compare it with the one last read. */
export const nodeWrites = () => writes

/** A node field no pose hook hears was written. */
export const noteNodeWrite = () => void writes++

/** `reparentTransformNode`, counted: the one way a scene node changes parent. */
export function reparentTransformNode(tree: TransformTree, node: number, parent: number) {
  structure.reparentTransformNode(tree, node, parent)
  noteObjectEdit()
  noteNodeWrite()
}

/** `removeTransformNode`, counted: a freed node leaves its parent. */
export function removeTransformNode(tree: TransformTree, node: number) {
  structure.removeTransformNode(tree, node)
  noteObjectEdit()
  noteNodeWrite()
}

/** `setNodeLocalMatrix`, counted: a scene node's matrix set by hand. */
export function setNodeLocalMatrix(tree: TransformTree, node: number, m: ArrayLike<number>) {
  setLocalMatrix(tree, node, m)
  noteNodeWrite()
}

/** `setNodeAutoUpdate`, counted: whether a scene node's matrix follows its pose. */
export function setNodeAutoUpdate(tree: TransformTree, node: number, auto: boolean) {
  setAutoUpdate(tree, node, auto)
  noteNodeWrite()
}
