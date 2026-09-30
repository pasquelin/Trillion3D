import test from 'node:test';
import assert from 'node:assert/strict';
import { depthOf } from './meshDepth.ts';

// Issue #275: an instanced mesh is sorted by the union of its placements' spheres, grown as the
// reference grows it, never by its geometry's sphere alone.

// Issue #275: a mesh is sorted on the normalised-device z of its sphere's centre, the clip z over
// the clip w, so two meshes behind the camera order as the reference orders them.
test('the sort depth is the normalised-device z, behind the camera as in front', async () => {
  const { Matrix4, PerspectiveCamera, Vector3 } = await import('three');
  const camera = new PerspectiveCamera(60, 1, 0.1, 100);
  camera.updateMatrixWorld();
  const screen = new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  for (const z of [-5, -50, 3, 40]) {
    const matrix = new Matrix4().makeTranslation(1, 2, z);
    const expected = new Vector3().setFromMatrixPosition(matrix).applyMatrix4(screen).z;
    const mesh = { boundingSphere: { center: { x: 0, y: 0, z: 0 } }, matrixWorld: matrix };
    assert.equal(depthOf(mesh, screen.elements), expected, `a centre at z = ${z}`);
  }
});
