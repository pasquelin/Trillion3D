// Défaut 1 (rejet par cône à petite échelle) : `isConformal` doit juger sur des rapports de
// longueurs et d'orthogonalité purement relatifs, jamais sur une tolérance additive qui, à petite
// échelle, masque une vraie déformation anisotrope. Le premier test reprend le cas déclencheur de
// `bench/justesse/cone-echelle-non-uniforme.mjs` ; les suivants couvrent les 3×3 dégénérées, puis
// confirment que le rejet reste possible pour toute échelle uniforme et rotation, comme avant ce lot.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  coneContextFor,
  coneCullsPageWith,
  createConeContext,
  triangleCone,
  type NormalCone,
} from './pageCone.ts';
import { selectVisiblePages } from './pageSelectionCut.ts';
import type { ClusterRoot } from './pageSelectionTypes.ts';
import type { PageRecord } from './pageSelectionCutState.ts';

const VIEWPORT: [number, number] = [1000, 1000];
const POSITIONS = [0, 0, 0, 1e6, 0, -1e6, 0, 1e6, 0, 0, 0, 0, -1e6, 0, -1e6, 0, -1e6, 0];
const INDICES = [0, 1, 2, 3, 4, 5];
const TRIANGLES = INDICES.length / 3;
const MIN = [-1e6, -1e6, -1e6];
const MAX = [1e6, 1e6, 0];

/** La caméra du cas déclencheur : la face des deux triangles lui fait front, dans le tronc. */
function camera() {
  const cam = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  cam.position.set(6, 0, -9);
  cam.lookAt(0, 0, -0.5);
  cam.updateMatrixWorld(true);
  return cam;
}

/** Un unique cluster, la coupe CPU complète — seuls les champs que `selectFlat` lit vraiment. */
function trianglesGardes(world: THREE.Matrix4, cone: NormalCone, cam: THREE.PerspectiveCamera) {
  const page = {
    min: MIN,
    max: MAX,
    cone,
    triangles: TRIANGLES,
    lodError: 0,
  } as unknown as PageRecord;
  const root = { world, pages: [page], cones: true } as unknown as ClusterRoot<PageRecord>;
  return selectVisiblePages([root], cam, { pixelError: 0, viewport: VIEWPORT }).displayedTriangles;
}

test('échelle non uniforme à petite échelle (1e-8, 1e-6, 1e-6), cas déclencheur : les deux triangles restent', () => {
  const cone = triangleCone(POSITIONS, INDICES);
  const world = new THREE.Matrix4().makeScale(1e-8, 1e-6, 1e-6);
  const cam = camera();
  const ctx = coneContextFor(createConeContext(), world, cam);
  assert.equal(
    coneCullsPageWith(ctx, cone, world, MIN, MAX),
    false,
    'coneCullsPageWith rejette la face pourtant visible',
  );
  assert.equal(trianglesGardes(world, cone, cam), TRIANGLES, 'selectVisiblePages perd la face');
});

test('une 3×3 dégénérée (échelle nulle sur un axe, donc colonne nulle) n’est pas conforme : le cluster reste', () => {
  const cone: NormalCone = { axis: [0, 0, 1], angle: Math.PI / 6 };
  const cam = camera();
  for (const echelle of [
    [0, 1, 1],
    [1, 0, 1],
    [1, 1, 0],
  ] as const) {
    const world = new THREE.Matrix4().makeScale(...echelle);
    const ctx = coneContextFor(createConeContext(), world, cam);
    assert.equal(ctx.conformal, false, `échelle ${echelle}`);
    assert.equal(
      coneCullsPageWith(ctx, cone, world, [-1, -1, 0], [1, 1, 0]),
      false,
      `boîte conservée pour l’échelle ${echelle}`,
    );
  }
});

test('une 3×3 avec un terme NaN ou infini n’est pas conforme : le cluster reste', () => {
  const cone: NormalCone = { axis: [0, 0, 1], angle: Math.PI / 6 };
  const cam = camera();
  for (const [index, valeur] of [
    [0, NaN],
    [5, Infinity],
    [10, -Infinity],
  ] as const) {
    const world = new THREE.Matrix4();
    world.elements[index] = valeur;
    const ctx = coneContextFor(createConeContext(), world, cam);
    assert.equal(ctx.conformal, false, `terme ${index} = ${valeur}`);
    assert.equal(
      coneCullsPageWith(ctx, cone, world, [-1, -1, 0], [1, 1, 0]),
      false,
      `boîte conservée pour le terme ${index} = ${valeur}`,
    );
  }
});

test('échelle uniforme de 1e-8 à 1e3, avec rotation : une face dos à la caméra reste rejetée', () => {
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
      const conforme = coneContextFor(createConeContext(), world, camera());
      assert.equal(conforme.conformal, true, `échelle ${echelle} rotation ${euler}`);
      const axeMonde = new THREE.Vector3(...cone.axis).applyMatrix3(conforme.normal).normalize();
      const distance = Math.max(5, echelle * 2000);
      const cam = new THREE.PerspectiveCamera(55, 1, 0.1, distance * 100);
      cam.position.copy(axeMonde).multiplyScalar(-distance);
      cam.lookAt(0, 0, 0);
      cam.updateMatrixWorld(true);
      const ctxArriere = coneContextFor(createConeContext(), world, cam);
      assert.equal(
        coneCullsPageWith(ctxArriere, cone, world, [-1, -1, -1], [1, 1, 1]),
        true,
        `échelle ${echelle} rotation ${euler} : face dos caméra non rejetée`,
      );
    }
  }
});
