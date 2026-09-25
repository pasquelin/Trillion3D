// CPU/GPU consistency of the cut decision on an off-axis sample.
//
// Thousands of clusters drawn in a primitive rotated and stretched non-uniformly: view centre to
// the field edges, depths to the neighbourhood of the near plane, errors chosen so the projected
// error falls around the threshold. Boxes cover the whole frustum: only the error decision is
// compared. Three decisions per cluster: the cut rule on `clusterPixels` (original f64 values), the
// kernel's Node oracle (values packed as f32, computed in f64) and the WGSL kernel actually run
// in Chromium WebGPU (all f32). Each discrepancy is listed with its margin relative to the
// threshold, the measure of what f32 rounding can flip.
//
// node --experimental-strip-types tests/browser/probes/screen-error-cpu-gpu.ts [n]
import assert from 'node:assert/strict';
import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts';
import { maxStretch } from '../../../packages/sdk-core/src/index.ts';
import {
  clusterPixels,
  projectedClusterError,
} from '../../../packages/sdk-browser/src/page/selection/math.ts';
import { drawsCluster } from '../../../packages/sdk-browser/src/page/cut/rule.ts';
import { cameraSelectionUniforms } from '../../../packages/sdk-browser/src/gpu/core/selection.ts';
import {
  evaluateDagSelectionKernel,
  packDagSelection,
  packedWorldsToRenderOrigin,
} from '../../../packages/sdk-browser/src/gpu/dag/selection.ts';
import { selectionGpu } from './selectionKernelGpu.ts';
import { lois, xorshift32 } from './randomDraw.ts';
import { cameraMoteur } from '../../../packages/sdk-browser/src/camera/camera.fixture.ts';

interface Page {
  url: string;
  lodError: number;
  parentError: number;
  sphere?: number[];
  parentSphere?: number[];
  min?: number[];
  max?: number[];
}

const N = Number(process.argv[2] ?? 20000);
const SEUIL = 0.75;
const VIEWPORT: [number, number] = [1600, 900];
const { hasard, entre, log } = lois(xorshift32(0x2545f491));

const camera = G.perspectiveCamera(75, VIEWPORT[0] / VIEWPORT[1], 0.05, 2000);
camera.position.set(3, -2, 7);
camera.lookAt(-4, 1, -20);
camera.updateMatrixWorld(true);
const world = new G.Matrix4().compose(
  new G.Vector3(1, 2, -3),
  new G.Quaternion().setFromEuler(new G.Euler(0.4, -0.9, 0.3)),
  new G.Vector3(0.6, 1.7, 1.1),
);
const view = new G.Matrix4().multiplyMatrices(camera.matrixWorldInverse, world).elements;
const versObjet = new G.Matrix4().multiplyMatrices(camera.matrixWorldInverse, world).invert();
const stretch = maxStretch(world.elements) * maxStretch(camera.matrixWorldInverse.elements);
const uniforms = cameraSelectionUniforms(cameraMoteur(camera), SEUIL, VIEWPORT);
const focal = Math.max(uniforms.pixelScale[0], uniforms.pixelScale[1]);
const p00 = camera.projectionMatrix.elements[0],
  p11 = camera.projectionMatrix.elements[5];

const GRAND = 1e5;
const pages: Page[] = [];
for (let i = 0; i < N; i++) {
  const radius = log(1e-3, 2);
  const proche = hasard() < 0.25;
  const marge = radius * stretch * 2.2;
  const depth = proche ? camera.near + marge + camera.near * log(1e-4, 1) : marge + log(0.2, 400);
  const v = new G.Vector3(
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
// The kernel works in the render frame: packed world matrices are brought to the eye, exactly as
// the engine carries them, otherwise relative view and absolute world would mix in the same
// formula.
packedWorldsToRenderOrigin(packed, [{ world, pages: [] }], uniforms.cameraWorld);
const gpu = await selectionGpu([{ name: 'echantillon', packed, uniforms }]);
assert.equal(gpu.indisponible ?? null, null);
assert.deepEqual([...(gpu.compilation ?? []), ...(gpu.erreurs ?? [])], []);

const cpu = pages.map((rec) => {
  const [own, parent] = clusterPixels(
    rec,
    view,
    stretch,
    focal,
    camera.near,
    1,
    new Float64Array(2),
  );
  return drawsCluster(true, parent, own, true, SEUIL);
});
const auGpu = new Uint8Array(N),
  aLOracle = new Uint8Array(N);
assert.ok(gpu.resultats, 'no result');
for (const i of gpu.resultats[0].pages) auGpu[i] = 1;
for (const i of evaluateDagSelectionKernel(packed, uniforms).pageIds) aLOracle[i] = 1;
const marge = (rec: Page): number => {
  const bande = [
    projectedClusterError(rec.lodError, rec.sphere, 0, view, stretch, focal, camera.near),
    projectedClusterError(rec.parentError, rec.parentSphere, 0, view, stretch, focal, camera.near),
  ];
  return Math.min(...bande.map((p) => Math.abs(p - SEUIL) / SEUIL));
};
const ecarts = (autre: Uint8Array) =>
  pages
    .map((rec, i) => ({ i, cpu: cpu[i], autre: !!autre[i] }))
    .filter((e) => e.cpu !== e.autre)
    .map((e) => ({ ...e, margeRelative: marge(pages[e.i]) }));
const cpuGpu = ecarts(auGpu),
  cpuOracle = ecarts(aLOracle);
const oracleGpu = pages.filter((_, i) => aLOracle[i] !== auGpu[i]).length;
const pireMarge = (liste: Array<{ margeRelative: number }>): number =>
  Math.max(0, ...liste.map((e) => e.margeRelative));
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
// A discrepancy is admitted only in the band that f32 rounding of spheres and matrices can flip.
assert.ok(pireMarge(cpuGpu) < 1e-5, 'CPU/GPU discrepancy outside the f32 rounding band');
