import test from 'node:test';
import assert from 'node:assert/strict';
import { placementsCentre } from './meshDepth.ts';
import { GraphInstancedMesh } from '../../host/graph/mesh.ts';
import { GraphGeometry } from '../../host/graph/geometry.ts';
import { GraphAttribute } from '../../host/graph/attributes.ts';
import { GraphSurface } from '../../host/graph/surface.ts';

// Issue #275: an instanced mesh is sorted by the union of its placements' spheres, grown as the
// reference grows it, never by its geometry's sphere alone.
test('an instanced mesh sorts on the union of its placement spheres, as the reference computes it', async () => {
  const { InstancedMesh, BufferGeometry, BufferAttribute, Matrix4, Quaternion, Vector3 } =
    await import('three');
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0, 3]);
  const count = 7;
  const reference = new BufferGeometry();
  reference.setAttribute('position', new BufferAttribute(positions, 3));
  const witness = new InstancedMesh(reference, undefined, count);
  const geometry = new GraphGeometry();
  geometry.setAttribute('position', new GraphAttribute(positions, 3));
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
