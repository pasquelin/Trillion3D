import * as structure from '../../math/transform-tree/structure.ts';
import type { TransformTree } from '../../math/transform-tree/transformTree.ts';

/** How many times any scene node was renamed or changed parent since the page loaded: an answer
 *  found by walking names — the engine's name index of a prepared scene — holds while it stands. */
let edits = 0;

/** The current count: compare it with the one an answer was built under. */
export const objectEdits = () => edits;

/** A name or a parent changed. */
export const noteObjectEdit = () => void edits++;

/** `reparentTransformNode`, counted: the one way a scene node changes parent. */
export function reparentTransformNode(tree: TransformTree, node: number, parent: number) {
  structure.reparentTransformNode(tree, node, parent);
  noteObjectEdit();
}

/** `removeTransformNode`, counted: a freed node leaves its parent. */
export function removeTransformNode(tree: TransformTree, node: number) {
  structure.removeTransformNode(tree, node);
  noteObjectEdit();
}
