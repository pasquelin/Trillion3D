import type { Camera } from '../../../../sdk-core/src/world/camera/camera.ts';
import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts';
import type { PhysicsSession } from '../../physics/session.ts';
import { poseNamed } from '../../host/world/moveByName.ts';
import { createWorldRaycast } from './worldRaycast.ts';

/**
 * A world's moves by name (#972), and the methods it exposes over the nodes of its scene.
 *
 * `namedMove` is the one move path a world built in code takes: the node the scene's own name
 * index finds, posed from its host chain exactly as WebGPU's and WebGL2's moves by name pose
 * theirs, and its row marked for the next frame — the runtime hands it to the session
 * (`ExplorerSource.moveNamed`) and offers it to the page (`worldSceneMethods`). `worldSceneMethods`
 * groups the two world members that reach a scene node the page holds no handle to: picking it
 * (`world.raycast`) and moving it by its name (`world.setTransform`).
 */

/** The move by name a world takes: `nodeName` posed so its world is `matrix`, its row marked and
 *  a frame asked. No node bears the name, a non-sixteen-float pose or a non-finite one is refused
 *  by the code `namedNode`/`assertFiniteTransform` give (`host/world/moveByName.ts`). */
export function namedMove(
  scene: Object3D,
  poses: { moved(node: Object3D): void },
  invalidate: () => void,
) {
  return (nodeName: string, matrix: Float32Array) => {
    const node = poseNamed(scene, nodeName, matrix);
    if (node) poses.moved(node);
    invalidate();
  };
}

/**
 * The two world members acting on a scene node by name or by a screen point:
 * - `raycast`, the nearest object a canvas point or a world ray meets (`createWorldRaycast`);
 * - `setTransform`, a node moved by its name through the engine's own name-indexed path.
 */
export function worldSceneMethods(
  scene: Object3D,
  camera: () => Camera,
  canvas: HTMLCanvasElement,
  physics: () => PhysicsSession | null,
  runtime: { moveNamed(nodeName: string, matrix: Float32Array): void },
) {
  return {
    /** The nearest object under a canvas point (CSS pixels) or along a world ray, or `null`:
     *  the node the page added, the world point and normal hit, the distance (`worldRaycast`). */
    raycast: createWorldRaycast(scene, camera, canvas, physics),
    /**
     * Moves the node `nodeName` so that its world pose is `matrix`: a node the page does not keep
     * a handle to is reached by its name (`object.name`), looked up on the scene. The pose is a
     * world pose — the engine brings it back into the node's parent space — so a name under a
     * moved parent still lands where asked. The same route WebGPU and WebGL2 take for a page's
     * move by name, not a second one. The next frame draws it; a request that changes nothing
     * asks no frame.
     * @param nodeName - The `name` of the node to move.
     * @param matrix - Its world pose, sixteen floats in column-major order.
     * @throws `UNKNOWN_SCENE_NODE` when no node of the scene bears the name,
     * `INVALID_TRANSFORM` when `matrix` is not sixteen floats and `NON_FINITE_TRANSFORM` when one
     * of them is not finite.
     */
    setTransform(nodeName: string, matrix: Float32Array) {
      runtime.moveNamed(nodeName, matrix);
    },
  };
}
