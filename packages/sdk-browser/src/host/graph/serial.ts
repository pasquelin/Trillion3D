/**
 * THE CREATION NUMBER OF THE ENGINE'S NODES: one count, from one, for every node the engine builds
 * — its lights (`GraphNode.serial`) and its scenes, cameras and meshes, the core's, numbered here
 * as they are built or copied. A draw breaks depth ties with it; a diagnostic seeds a colour with
 * it. A node a page builds takes no number: it is the world's, drawn through the engine's own copy.
 */
import { Mesh } from '../../../../sdk-core/src/world/object/mesh.ts';
import { Camera } from '../../../../sdk-core/src/world/camera/camera.ts';
import { Scene } from '../../world/core/scene.ts';
import { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts';

let next = 1;
/** A number no engine node has yet. */
export const takeSerial = () => next++;

const numbers = new WeakMap<object, number>();

/** The nodes the engine numbers: its meshes, cameras and scenes. */
const isNumbered = (node: Object3D) =>
  node instanceof Mesh || node instanceof Camera || node instanceof Scene;

/** Numbers every mesh, camera and scene of `node`'s subtree not numbered yet, in the order a
 *  copy builds them; a host object that is no node of the core's is left as it is. */
export function numbered<T extends object>(node: T): T {
  if (node instanceof Object3D)
    node.traverse((part) => {
      if (isNumbered(part) && !numbers.has(part)) numbers.set(part, takeSerial());
    });
  return node;
}

/** The engine's number of a node, or `undefined` for one it did not build. */
export const serialOf = (node: object): number | undefined =>
  numbers.get(node) ?? (node as { serial?: number }).serial;
