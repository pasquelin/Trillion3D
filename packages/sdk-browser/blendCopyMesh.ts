import * as THREE from 'three';
import { asHostLibrary } from './hostResources.ts';
import type { MatrixElements } from './matrixElements.ts';

/**
 * The draw copy of a transparent surface.
 *
 * A blended or transmissive surface is not drawn by the opaque path: the engine holds a
 * copy of it, in source order, with the mesh material. What this copy carries as placement
 * is the ONLY thing that still ties it to the scene, and that is where the defect lived:
 * copying a world matrix at prepare time made it a snapshot that no later move —
 * `setTransform`, a moved parent, a direct host write — would correct.
 *
 * The copy therefore reads the engine's world STORAGE for the source mesh
 * (`hostWorldPlacements.ts`), not a copy of its sixteen numbers: the host matrix built here is
 * a container whose `elements` ARE the engine's view, so what a pass rewrites there the copy
 * reads — like the opaque pages of the same mesh, which carry that same pose.
 * `matrixAutoUpdate` stays false, so Three never recomposes this matrix from the copy's local
 * pose — which it does not have.
 */
export function createBlendCopy(mesh: THREE.Mesh, renderOrder: number, world: MatrixElements) {
  const copy = new THREE.Mesh(mesh.geometry, mesh.material);
  copy.matrixAutoUpdate = false;
  copy.matrix = Object.assign(new THREE.Matrix4(), {
    elements: asHostLibrary<number[]>(world.elements),
  });
  copy.frustumCulled = mesh.frustumCulled;
  copy.renderOrder = renderOrder;
  copy.userData.sourceMesh = mesh;
  return copy;
}
