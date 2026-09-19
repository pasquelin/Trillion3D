import * as THREE from 'three';

/**
 * The draw copy of a transparent surface.
 *
 * A blended or transmissive surface is not drawn by the opaque path: the engine holds a
 * copy of it, in source order, with the mesh material. What this copy carries as placement
 * is the ONLY thing that still ties it to the scene, and that is where the defect lived:
 * copying a world matrix at prepare time made it a snapshot that no later move —
 * `setTransform`, a moved parent, a direct host write — would correct.
 *
 * The copy therefore receives the `world` OBJECT the engine holds for the source mesh
 * (`hostWorldPlacements.ts`), not its sixteen numbers: what the index rewrites there, the
 * copy reads — like the opaque pages of the same mesh, which carry that same matrix.
 * `matrixAutoUpdate` stays false, so Three never recomposes this matrix from the copy's
 * local pose — which it does not have.
 */
export function createBlendCopy(mesh: THREE.Mesh, renderOrder: number, world: THREE.Matrix4) {
  const copy = new THREE.Mesh(mesh.geometry, mesh.material);
  copy.matrixAutoUpdate = false;
  copy.matrix = world;
  copy.frustumCulled = mesh.frustumCulled;
  copy.renderOrder = renderOrder;
  copy.userData.sourceMesh = mesh;
  return copy;
}
