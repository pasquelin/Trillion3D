// Correctness of cone rejection under a non-uniform transform at small scale.
//
// Two real triangles at large local coordinates, placed by a scale (1e-8, 1e-6, 1e-6): a two-unit
// object in the world, facing the camera, entirely in the frustum. Such a transform is not
// conformal (lengths ×100): the normal cone does not transport, the cluster must be kept. The
// script queries the real `coneCullsPageWith`, the real `selectVisiblePages`, the kernel's Node
// oracle and the WGSL kernel actually run in Chromium WebGPU, then fails if any of them drops
// the triangles.
//
// node --experimental-strip-types test/justesse/cone-echelle-non-uniforme.ts
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  coneContextFor,
  coneCullsPageWith,
  createConeContext,
  OPEN_CONE,
  triangleCone,
} from '../../packages/sdk-browser/pageCone.ts';
import { selectVisiblePages } from '../../packages/sdk-browser/pageSelectionCut.ts';
import { cameraSelectionUniforms } from '../../packages/sdk-browser/gpuSelection.ts';
import {
  evaluateDagSelectionKernel,
  packDagSelection,
  packedWorldsToRenderOrigin,
} from '../../packages/sdk-browser/gpuDagSelection.ts';
import { selectionGpu } from './noyauSelectionGpu.ts';
import { cameraMoteur } from '../../packages/sdk-browser/cameraFixture.ts';
import type { NormalCone } from '../../packages/sdk-browser/pageCone.ts';
import type { PackedDag } from '../../packages/sdk-browser/gpuDagTypes.ts';

const positions = [0, 0, 0, 1e6, 0, -1e6, 0, 1e6, 0, 0, 0, 0, -1e6, 0, -1e6, 0, -1e6, 0];
const indices = [0, 1, 2, 3, 4, 5];
const TRIANGLES = indices.length / 3;
const cone = triangleCone(positions, indices);
const min = [-1e6, -1e6, -1e6],
  max = [1e6, 1e6, 0];
const world = new THREE.Matrix4().makeScale(1e-8, 1e-6, 1e-6);
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
camera.position.set(6, 0, -9);
camera.lookAt(0, 0, -0.5);
camera.updateMatrixWorld(true);
const VIEWPORT: [number, number] = [1000, 1000];

/** What the camera sees, computed on world vertices: the face is visible, and large. */
function temoin() {
  const sommets = [0, 1, 2].map((i) =>
    new THREE.Vector3().fromArray(positions, i * 3).applyMatrix4(world),
  );
  const normale = new THREE.Vector3()
    .subVectors(sommets[1], sommets[0])
    .cross(new THREE.Vector3().subVectors(sommets[2], sommets[0]))
    .normalize();
  const face = normale.dot(camera.position.clone().sub(sommets[0]).normalize());
  const ndc = sommets.map((v) => v.clone().project(camera));
  const aire =
    (Math.abs(
      (ndc[1].x - ndc[0].x) * (ndc[2].y - ndc[0].y) - (ndc[2].x - ndc[0].x) * (ndc[1].y - ndc[0].y),
    ) *
      (VIEWPORT[0] / 2) *
      (VIEWPORT[1] / 2)) /
    2;
  const dansLeTronc = ndc.every((v) => Math.abs(v.x) < 1 && Math.abs(v.y) < 1 && Math.abs(v.z) < 1);
  return { face, airePixels: aire, dansLeTronc };
}

/** The engine's CPU cut, cones on or off. */
function coupeCpu(cones: boolean) {
  const box = new THREE.Box3(new THREE.Vector3(...min), new THREE.Vector3(...max)).applyMatrix4(
    world,
  );
  const page = {
    id: '0',
    url: '0',
    triangles: TRIANGLES,
    min,
    max,
    cone,
    lodError: 0,
    matrix: world,
    material: new THREE.MeshBasicMaterial({ side: THREE.FrontSide }),
  };
  const root = {
    world,
    pages: [page],
    cones,
    worldBox: new Float64Array([...box.min.toArray(), ...box.max.toArray()]),
  };
  return selectVisiblePages([root], cameraMoteur(camera), { pixelError: 0, viewport: VIEWPORT })
    .displayedTriangles;
}

/** The same cluster for the GPU kernel: DAG root, null error, always in its band. */
function empaquete(coneDuCluster: NormalCone) {
  const sphere = [0, 0, -0.5, 2];
  return packDagSelection([
    {
      world,
      pages: [{ url: '0', lodError: 0, parentError: null, sphere, min, max, cone: coneDuCluster }],
    },
  ]);
}

const uniforms = cameraSelectionUniforms(cameraMoteur(camera), 0, VIEWPORT);
const context = coneContextFor(createConeContext(), world, cameraMoteur(camera).eye);
// The kernel works in the render frame: packed world matrices are brought to the eye, as the
// engine carries them, otherwise relative view and absolute world would mix.
const rebase = (packed: PackedDag): PackedDag =>
  packedWorldsToRenderOrigin(packed, [{ world, pages: [] }], uniforms.cameraWorld);
const avecCone = rebase(empaquete(cone)),
  sansCone = rebase(empaquete(OPEN_CONE));
const gpu = await selectionGpu([
  { name: 'avecCone', packed: avecCone, uniforms },
  { name: 'sansCone', packed: sansCone, uniforms },
]);
const pagesGpu = (nom: string) => gpu.resultats?.find((r) => r.name === nom)?.pages ?? null;
const rapport = {
  temoin: temoin(),
  cone,
  cpu: {
    conforme: context.conformal,
    coneRejette: coneCullsPageWith(context, cone, world, min, max),
    trianglesAvecCone: coupeCpu(true),
    trianglesSansCone: coupeCpu(false),
  },
  oracleNoyau: {
    pagesAvecCone: evaluateDagSelectionKernel(avecCone, uniforms).pageIds,
    pagesSansCone: evaluateDagSelectionKernel(sansCone, uniforms).pageIds,
  },
  gpu: {
    adaptateur: gpu.adaptateur ?? null,
    erreurs: [...(gpu.compilation ?? []), ...(gpu.erreurs ?? [])],
    indisponible: gpu.indisponible ?? null,
    trianglesAvecCone: (pagesGpu('avecCone')?.length ?? NaN) * TRIANGLES,
    trianglesSansCone: (pagesGpu('sansCone')?.length ?? NaN) * TRIANGLES,
  },
};
console.log(JSON.stringify(rapport, null, 2));

const { face, airePixels, dansLeTronc } = rapport.temoin;
assert.ok(face > 0 && airePixels > 100 && dansLeTronc, 'the case must show a visible face');
assert.equal(rapport.gpu.indisponible, null);
assert.deepEqual(rapport.gpu.erreurs, []);
assert.equal(rapport.cpu.trianglesSansCone, TRIANGLES);
assert.equal(rapport.gpu.trianglesSansCone, TRIANGLES);
assert.equal(rapport.cpu.coneRejette, false, 'CPU: coneCullsPageWith rejects a visible face');
assert.equal(rapport.cpu.trianglesAvecCone, TRIANGLES, 'CPU: selectVisiblePages loses the face');
assert.deepEqual(rapport.oracleNoyau.pagesAvecCone, [0], 'kernel oracle: the page is rejected');
assert.equal(rapport.gpu.trianglesAvecCone, TRIANGLES, 'GPU: the WGSL kernel rejects the face');
