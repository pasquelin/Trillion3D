// Justesse du rejet par cône sous une transformation non uniforme à petite échelle.
//
// Deux vrais triangles aux grandes coordonnées locales, placés par une échelle (1e-8, 1e-6, 1e-6) :
// un objet de deux unités dans le monde, face à la caméra, entièrement dans le tronc. Une telle
// transformation n'est pas conforme (longueurs ×100) : le cône de normales ne s'y transporte pas,
// le cluster doit être conservé. Le script interroge le vrai `coneCullsPageWith`, le vrai
// `selectVisiblePages`, l'oracle Node du noyau et le noyau WGSL réellement exécuté dans Chromium
// WebGPU, puis échoue si l'un d'eux retire les triangles.
//
// node --experimental-strip-types packages/sdk-browser/bench/justesse/cone-echelle-non-uniforme.mjs
// (LAB_ROOT désigne `render-tech-lab` si le dépôt n'est pas son voisin.)
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  coneContextFor,
  coneCullsPageWith,
  createConeContext,
  OPEN_CONE,
  triangleCone,
} from '../../pageCone.ts';
import { selectVisiblePages } from '../../pageSelectionCut.ts';
import { cameraSelectionUniforms } from '../../gpuSelection.ts';
import {
  evaluateDagSelectionKernel,
  packDagSelection,
  packedWorldsToRenderOrigin,
} from '../../gpuDagSelection.ts';
import { selectionGpu } from './noyauSelectionGpu.mjs';
import { cameraMoteur } from '../../cameraFixture.ts';

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
const VIEWPORT = [1000, 1000];

/** Ce que voit la caméra, calculé sur les sommets monde : la face est visible, et grande. */
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

/** La coupe CPU du moteur, cônes actifs ou non. */
function coupeCpu(cones) {
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

/** Le même cluster pour le noyau GPU : racine du DAG, erreur nulle, toujours dans sa bande. */
function empaquete(coneDuCluster) {
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
// Le noyau travaille dans le repère de rendu : les matrices monde empaquetées sont ramenées à
// l'œil, comme le moteur les lui porte, sans quoi vue relative et monde absolu se mêleraient.
const rebase = (packed) => packedWorldsToRenderOrigin(packed, [{ world }], uniforms.cameraWorld);
const avecCone = rebase(empaquete(cone)),
  sansCone = rebase(empaquete(OPEN_CONE));
const gpu = await selectionGpu([
  { nom: 'avecCone', packed: avecCone, uniforms },
  { nom: 'sansCone', packed: sansCone, uniforms },
]);
const pagesGpu = (nom) => gpu.resultats?.find((r) => r.nom === nom)?.pages ?? null;
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
assert.ok(face > 0 && airePixels > 100 && dansLeTronc, 'le cas doit montrer une face visible');
assert.equal(rapport.gpu.indisponible, null);
assert.deepEqual(rapport.gpu.erreurs, []);
assert.equal(rapport.cpu.trianglesSansCone, TRIANGLES);
assert.equal(rapport.gpu.trianglesSansCone, TRIANGLES);
assert.equal(rapport.cpu.coneRejette, false, 'CPU : coneCullsPageWith rejette une face visible');
assert.equal(rapport.cpu.trianglesAvecCone, TRIANGLES, 'CPU : selectVisiblePages perd la face');
assert.deepEqual(rapport.oracleNoyau.pagesAvecCone, [0], 'oracle du noyau : la page est rejetée');
assert.equal(rapport.gpu.trianglesAvecCone, TRIANGLES, 'GPU : le noyau WGSL rejette la face');
