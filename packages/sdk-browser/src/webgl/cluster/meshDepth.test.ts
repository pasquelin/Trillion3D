import test from 'node:test';
import assert from 'node:assert/strict';
import { depthOf, placementsCentre } from './meshDepth.ts';
import { GraphInstancedMesh } from '../../host/graph/mesh.ts';
import { GraphGeometry } from '../../host/graph/geometry.ts';
import { BufferAttribute } from '../../../../sdk-core/src/world/buffer/attribute.ts';
import { GraphSurface } from '../../host/graph/surface.ts';

// Issue #275: an instanced mesh is sorted by the union of its placements' spheres, grown as the
// reference grows it, never by its geometry's sphere alone.
test('an instanced mesh sorts on the union of its placement spheres, as the reference computes it', async () => {
  const {
    InstancedMesh,
    BufferGeometry,
    BufferAttribute: WitnessAttribute,
    Matrix4,
    Quaternion,
    Vector3,
  } = await import('three');
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0, 3]);
  const count = 7;
  const reference = new BufferGeometry();
  reference.setAttribute('position', new WitnessAttribute(positions, 3));
  const witness = new InstancedMesh(reference, undefined, count);
  const geometry = new GraphGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  const placed = new GraphInstancedMesh(geometry, new GraphSurface('standard'), count);
  const matrix = new Matrix4();
  for (let i = 0; i < count; i++) {
    matrix.compose(
      new Vector3(i * 3.5 - 4, (i % 3) * 1.25, -i * 2),
      new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), i * 0.7),
      new Vector3(1 + i * 0.25, 1, 1 + (i % 2)),
    );
    witness.setMatrixAt(i, matrix);
    placed.instanceMatrix.array.set(matrix.elements, i * 16);
  }
  witness.computeBoundingSphere();
  geometry.computeBoundingSphere();
  const centre = placementsCentre(placed, geometry.boundingSphere!);
  assert.deepEqual(
    [centre.x, centre.y, centre.z],
    [
      witness.boundingSphere!.center.x,
      witness.boundingSphere!.center.y,
      witness.boundingSphere!.center.z,
    ],
  );
  assert.notDeepEqual(
    [centre.x, centre.y, centre.z],
    [
      geometry.boundingSphere!.center.x,
      geometry.boundingSphere!.center.y,
      geometry.boundingSphere!.center.z,
    ],
    'the geometry sphere alone is not the placement sphere',
  );
  // Kept while the matrices are unchanged, recomputed once they are.
  assert.equal(placementsCentre(placed, geometry.boundingSphere!), centre);
  placed.instanceMatrix.needsUpdate = true;
  assert.notEqual(placementsCentre(placed, geometry.boundingSphere!), centre);
});

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
