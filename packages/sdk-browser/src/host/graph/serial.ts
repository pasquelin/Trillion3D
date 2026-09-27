/**
 * THE CREATION NUMBER OF THE ENGINE'S NODES: one count, from one, for every node the engine builds
 * — its cameras and lights (`GraphNode.serial`) and its meshes, the core's, numbered here as they
 * are built or copied. A draw breaks depth ties with it; a diagnostic seeds a colour with it. A
 * mesh a page builds takes no number: it is the world's, drawn through the engine's own copy.
 */
import { Mesh } from '../../../../sdk-core/src/world/object/mesh.ts';
import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts';

let next = 1;
/** A number no engine node has yet. */
export const takeSerial = () => next++;

const numbers = new WeakMap<object, number>();

/** Numbers every mesh of `node`'s subtree not numbered yet, in the order a copy builds them. */
export function numbered<T extends Object3D>(node: T): T {
  node.traverse((part) => {
    if (part instanceof Mesh && !numbers.has(part)) numbers.set(part, takeSerial());
  });
  return node;
}

/** The engine's number of a node, or `undefined` for one it did not build. */
export const serialOf = (node: object): number | undefined =>
  numbers.get(node) ?? (node as { serial?: number }).serial;
