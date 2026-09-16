// Cohérence CPU/GPU de la décision de coupe sur un échantillon hors axe.
//
// Des milliers de clusters tirés dans une primitive tournée et étirée de façon non uniforme : centre
// de vue jusqu'aux bords du champ, profondeurs jusqu'au voisinage du plan proche, erreurs choisies
// pour que l'erreur projetée tombe autour du seuil. Les boîtes couvrent tout le tronc : seule la
// décision d'erreur est comparée. Trois décisions par cluster : `cutSelects` de la coupe CPU
// (valeurs f64 d'origine), l'oracle Node du noyau (valeurs empaquetées en f32, calcul en f64) et le
// noyau WGSL réellement exécuté dans Chromium WebGPU (tout en f32). Chaque écart est listé avec sa
// marge relative au seuil, la mesure de ce que l'arrondi f32 peut basculer.
//
// node --experimental-strip-types packages/sdk-browser/bench/justesse/erreur-ecran-cpu-gpu.mjs [n]
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { maxStretch } from '../../../sdk-core/index.ts';
import { cutSelects, projectedClusterError } from '../../pageSelectionMath.ts';
import { cameraSelectionUniforms } from '../../gpuSelection.ts';
import {
  evaluateDagSelectionKernel,
  packDagSelection,
  packedWorldsToRenderOrigin,
} from '../../gpuDagSelection.ts';
import { selectionGpu } from './noyauSelectionGpu.mjs';
import { lois, xorshift32 } from './tirage.mjs';
import { cameraMoteur } from '../../cameraFixture.ts';

const N = Number(process.argv[2] ?? 20000);
const SEUIL = 0.75;
const VIEWPORT = [1600, 900];
const { hasard, entre, log } = lois(xorshift32(0x2545f491));

const camera = new THREE.PerspectiveCamera(75, VIEWPORT[0] / VIEWPORT[1], 0.05, 2000);
camera.position.set(3, -2, 7);
camera.lookAt(-4, 1, -20);
camera.updateMatrixWorld(true);
const world = new THREE.Matrix4().compose(
  new THREE.Vector3(1, 2, -3),
  new THREE.Quaternion().setFromEuler(new THREE.Euler(0.4, -0.9, 0.3)),
  new THREE.Vector3(0.6, 1.7, 1.1),
);
const view = new THREE.Matrix4().multiplyMatrices(camera.matrixWorldInverse, world).elements;
const versObjet = new THREE.Matrix4().multiplyMatrices(camera.matrixWorldInverse, world).invert();
const stretch = maxStretch(world.elements) * maxStretch(camera.matrixWorldInverse.elements);
const uniforms = cameraSelectionUniforms(cameraMoteur(camera), SEUIL, VIEWPORT);
const focal = Math.max(uniforms.pixelScale[0], uniforms.pixelScale[1]);
const p00 = camera.projectionMatrix.elements[0],
  p11 = camera.projectionMatrix.elements[5];

const GRAND = 1e5;
const pages = [];
for (let i = 0; i < N; i++) {
  const radius = log(1e-3, 2);
  const proche = hasard() < 0.25;
  const marge = radius * stretch * 2.2;
  const depth = proche ? camera.near + marge + camera.near * log(1e-4, 1) : marge + log(0.2, 400);
  const v = new THREE.Vector3(
    (entre(-1, 1) * depth) / p00,
    (entre(-1, 1) * depth) / p11,
    -depth,
  ).applyMatrix4(versObjet);
  const sphere = [v.x, v.y, v.z, radius];
  const decale = radius * entre(0, 0.2);
  const parentSphere = [v.x + decale, v.y, v.z, radius * 1.2 + decale];
  const unite = projectedClusterError(radius * 0.01, sphere, 0, view, stretch, focal, camera.near);
  const lodError = Number.isFinite(unite) ? radius * 0.01 * ((SEUIL * log(0.3, 3)) / unite) : 0.01;
  const parentError = Math.min(lodError * log(1, 4), radius);
  pages.push({ url: String(i), lodError: Math.min(lodError, parentError), parentError });
  Object.assign(pages[i], { sphere, parentSphere, min: [-GRAND, -GRAND, -GRAND] });
  pages[i].max = [GRAND, GRAND, GRAND];
}
const packed = packDagSelection([{ world, pages }]);
// Le noyau travaille dans le repère de rendu : les matrices monde empaquetées sont ramenées à
// l'œil, exactement comme le moteur les lui porte, sans quoi vue relative et monde absolu se
// mêleraient dans la même formule.
packedWorldsToRenderOrigin(packed, [{ world }], uniforms.cameraWorld);
const gpu = await selectionGpu([{ nom: 'echantillon', packed, uniforms }]);
assert.equal(gpu.indisponible ?? null, null);
assert.deepEqual([...(gpu.compilation ?? []), ...(gpu.erreurs ?? [])], []);

const cpu = pages.map((rec) => cutSelects(rec, view, stretch, focal, camera.near, SEUIL));
const auGpu = new Uint8Array(N),
  aLOracle = new Uint8Array(N);
for (const i of gpu.resultats[0].pages) auGpu[i] = 1;
for (const i of evaluateDagSelectionKernel(packed, uniforms).pageIds) aLOracle[i] = 1;
const marge = (rec) => {
  const bande = [
    projectedClusterError(rec.lodError, rec.sphere, 0, view, stretch, focal, camera.near),
    projectedClusterError(rec.parentError, rec.parentSphere, 0, view, stretch, focal, camera.near),
  ];
  return Math.min(...bande.map((p) => Math.abs(p - SEUIL) / SEUIL));
};
const ecarts = (autre) =>
  pages
    .map((rec, i) => ({ i, cpu: cpu[i], autre: !!autre[i] }))
    .filter((e) => e.cpu !== e.autre)
    .map((e) => ({ ...e, margeRelative: marge(pages[e.i]) }));
const cpuGpu = ecarts(auGpu),
  cpuOracle = ecarts(aLOracle);
const oracleGpu = pages.filter((_, i) => aLOracle[i] !== auGpu[i]).length;
const pireMarge = (liste) => Math.max(0, ...liste.map((e) => e.margeRelative));
console.log(
  JSON.stringify(
    {
      clusters: N,
      seuil: SEUIL,
      retenusCpu: cpu.filter(Boolean).length,
      retenusGpu: gpu.resultats[0].pages.length,
      adaptateur: gpu.adaptateur,
      ecartsCpuGpu: cpuGpu.length,
      pireMargeRelativeCpuGpu: pireMarge(cpuGpu),
      ecartsCpuOracle: cpuOracle.length,
      pireMargeRelativeCpuOracle: pireMarge(cpuOracle),
      ecartsOracleGpu: oracleGpu,
      premiersEcartsCpuGpu: cpuGpu.slice(0, 8),
    },
    null,
    2,
  ),
);
// Un écart n'est admis que dans la bande que l'arrondi f32 des sphères et des matrices peut basculer.
assert.ok(pireMarge(cpuGpu) < 1e-5, 'écart CPU/GPU hors de la bande d’arrondi f32');
