// Defect 1 (cone reject at small scale): `isConformal` must judge on purely relative length and
// orthogonality ratios, never on an additive tolerance which, at small scale, hides a real
// anisotropic deformation. The first test retakes the trigger case of
// `tests/browser/probes/cone-echelle-non-uniforme.ts`; the following cover degenerate 3×3s, then
// confirm that reject remains possible for any uniform scale and rotation, as before this batch.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  coneContextFor,
  coneCullsPageWith,
  createConeContext,
  triangleCone,
  type NormalCone,
} from './cone.ts';
import { selectVisiblePages } from '../cut/cut.ts';
import type { ClusterRoot } from '../selection/types.ts';
import type { PageRecord } from '../cut/state.ts';
import { cameraMoteur } from '../../camera/camera.fixture.ts';

const VIEWPORT: [number, number] = [1000, 1000];
const POSITIONS = [0, 0, 0, 1e6, 0, -1e6, 0, 1e6, 0, 0, 0, 0, -1e6, 0, -1e6, 0, -1e6, 0];
const INDICES = [0, 1, 2, 3, 4, 5];
const TRIANGLES = INDICES.length / 3;
const MIN = [-1e6, -1e6, -1e6];
const MAX = [1e6, 1e6, 0];

/** Camera of the trigger case: the face of both triangles faces it, in the frustum. */
function camera() {
  const cam = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  cam.position.set(6, 0, -9);
  cam.lookAt(0, 0, -0.5);
  cam.updateMatrixWorld(true);
  return cam;
}

/** A single cluster, the full CPU cut — only the fields `selectFlat` actually reads. */
function trianglesGardes(world: THREE.Matrix4, cone: NormalCone, cam: THREE.PerspectiveCamera) {
  const page = {
    min: MIN,
    max: MAX,
    cone,
    triangles: TRIANGLES,
    lodError: 0,
  } as unknown as PageRecord;
  const root = { world, pages: [page], cones: true } as unknown as ClusterRoot<PageRecord>;
  return selectVisiblePages([root], cameraMoteur(cam), { pixelError: 0, viewport: VIEWPORT })
    .displayedTriangles;
}

test('non-uniform scale at small scale (1e-8, 1e-6, 1e-6), trigger case: both triangles stay', () => {
  const cone = triangleCone(POSITIONS, INDICES);
  const world = new THREE.Matrix4().makeScale(1e-8, 1e-6, 1e-6);
  const cam = camera();
  const ctx = coneContextFor(createConeContext(), world, cameraMoteur(cam).eye);
  assert.equal(
    coneCullsPageWith(ctx, cone, world, MIN, MAX),
    false,
    'coneCullsPageWith rejects the face though it is visible',
  );
  assert.equal(trianglesGardes(world, cone, cam), TRIANGLES, 'selectVisiblePages loses the face');
});

test('a degenerate 3×3 (null scale on one axis, hence a null column) is not conformal: the cluster stays', () => {
  const cone: NormalCone = { axis: [0, 0, 1], angle: Math.PI / 6 };
  const cam = camera();
  for (const echelle of [
    [0, 1, 1],
    [1, 0, 1],
    [1, 1, 0],
  ] as const) {
    const world = new THREE.Matrix4().makeScale(echelle[0], echelle[1], echelle[2]);
    const ctx = coneContextFor(createConeContext(), world, cameraMoteur(cam).eye);
    assert.equal(ctx.conformal, false, `scale ${echelle}`);
    assert.equal(
      coneCullsPageWith(ctx, cone, world, [-1, -1, 0], [1, 1, 0]),
      false,
      `box kept for scale ${echelle}`,
    );
  }
});

test('a 3×3 with a NaN or infinite term is not conformal: the cluster stays', () => {
  const cone: NormalCone = { axis: [0, 0, 1], angle: Math.PI / 6 };
  const cam = camera();
  for (const [index, valeur] of [
    [0, NaN],
    [5, Infinity],
    [10, -Infinity],
  ] as const) {
    const world = new THREE.Matrix4();
    world.elements[index] = valeur;
    const ctx = coneContextFor(createConeContext(), world, cameraMoteur(cam).eye);
    assert.equal(ctx.conformal, false, `term ${index} = ${valeur}`);
    assert.equal(
      coneCullsPageWith(ctx, cone, world, [-1, -1, 0], [1, 1, 0]),
      false,
      `box kept for term ${index} = ${valeur}`,
    );
  }
});

test('uniform scale from 1e-8 to 1e3, with rotation: a face with its back to the camera stays rejected', () => {
  const cone: NormalCone = { axis: [0, 0, 1], angle: Math.PI / 6 };
  for (const echelle of [1e-8, 1e-4, 1, 1e3]) {
    for (const euler of [
      [0, 0, 0],
      [0.3, -0.5, 0.2],
    ] as const) {
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...euler));
      const world = new THREE.Matrix4().compose(
        new THREE.Vector3(),
        q,
        new THREE.Vector3(echelle, echelle, echelle),
      );
      const conforme = coneContextFor(createConeContext(), world, cameraMoteur(camera()).eye);
      assert.equal(conforme.conformal, true, `scale ${echelle} rotation ${euler}`);
      // The context's normal matrix is flat: the test puts it back in an object to apply it.
      const normale = new THREE.Matrix3().fromArray([...conforme.normal]);
      const axeMonde = new THREE.Vector3(...cone.axis).applyMatrix3(normale).normalize();
      const distance = Math.max(5, echelle * 2000);
      const cam = new THREE.PerspectiveCamera(55, 1, 0.1, distance * 100);
      cam.position.copy(axeMonde).multiplyScalar(-distance);
      cam.lookAt(0, 0, 0);
      cam.updateMatrixWorld(true);
      const ctxArriere = coneContextFor(createConeContext(), world, cameraMoteur(cam).eye);
      assert.equal(
        coneCullsPageWith(ctxArriere, cone, world, [-1, -1, -1], [1, 1, 1]),
        true,
        `scale ${echelle} rotation ${euler}: back-facing face not rejected`,
      );
    }
  }
});
