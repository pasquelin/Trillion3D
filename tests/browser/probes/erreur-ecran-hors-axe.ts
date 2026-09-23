// Correctness of off-axis screen error: a simplified cluster wrongly accepted at the 0.4 px
// threshold.
//
// A fine triangle placed off-axis, view centre (8, 0, −10), and its coarse replacement: the same
// triangle shifted vertically by ε. ε is chosen so the old formula announces 0.39 px; the true
// screen displacement of the vertices is 0.5 px. At the 0.4 px threshold, the cut must therefore
// keep the fine triangle. The script queries the real CPU cut (`selectVisiblePages`, flat and
// with a culling node and its bounds), the kernel's Node oracle and the WGSL kernel actually run
// in Chromium WebGPU, then fails if any of them keeps the coarse one.
//
// node --experimental-strip-types tests/browser/probes/erreur-ecran-hors-axe.ts
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { selectVisiblePages } from '../../../packages/sdk-browser/pageSelectionCut.ts';
import { projectedClusterError } from '../../../packages/sdk-browser/pageSelectionMath.ts';
import { cullingBounds } from '../../../packages/sdk-browser/pageSelectionCutBounds.ts';
import { cameraSelectionUniforms } from '../../../packages/sdk-browser/gpuSelection.ts';
import {
  evaluateDagSelectionKernel,
  packDagSelection,
  packedWorldsToRenderOrigin,
} from '../../../packages/sdk-browser/gpuDagSelection.ts';
import { selectionGpu } from './noyauSelectionGpu.ts';
import { cameraMoteur } from '../../../packages/sdk-browser/cameraFixture.ts';
import { surfaceOf } from '../../../packages/sdk-browser/pageSurface.ts';

const SEUIL = 0.4;
const VIEWPORT: [number, number] = [1920, 1080];
const camera = new THREE.PerspectiveCamera(60, VIEWPORT[0] / VIEWPORT[1], 0.1, 1000);
camera.updateMatrixWorld(true);
const world = new THREE.Matrix4();
const focal = (VIEWPORT[1] * camera.projectionMatrix.elements[5]) / 2;

const fin = [8, 0, -10, 8.01, 0, -10, 8, 0.01, -10];
/** Bounding sphere of a vertex list: box centre, radius to the farthest vertex. */
function sphereDe(sommets: number[]) {
  const box = new THREE.Box3().setFromArray(sommets);
  const c = box.getCenter(new THREE.Vector3());
  let r = 0;
  for (let i = 0; i < sommets.length; i += 3)
    r = Math.max(r, c.distanceTo(new THREE.Vector3().fromArray(sommets, i)));
  return { sphere: [c.x, c.y, c.z, r], min: box.min.toArray(), max: box.max.toArray() };
}
// ε such that the old formula, `ε·f / (|C| − r)`, announces 0.39 px for the coarse sphere.
const approche = sphereDe([...fin, 8, 0.006, -10]);
const [ax, ay, az, ar] = approche.sphere;
const EPS = (0.39 * (Math.hypot(ax, ay, az) - ar)) / focal;
const grossier = fin.map((v, i) => (i % 3 === 1 ? v + EPS : v));
const boiteFin = sphereDe(fin),
  boiteGrossier = sphereDe([...fin, ...grossier]);

/** True screen displacement, in pixels, between the fine and coarse vertices. */
function reel() {
  let pire = 0;
  for (let i = 0; i < fin.length; i += 3) {
    const a = new THREE.Vector3().fromArray(fin, i).project(camera);
    const b = new THREE.Vector3().fromArray(grossier, i).project(camera);
    pire = Math.max(pire, Math.hypot((b.x - a.x) * VIEWPORT[0], (b.y - a.y) * VIEWPORT[1]) / 2);
  }
  return pire;
}

const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
const page = (
  id: number,
  boite: ReturnType<typeof sphereDe>,
  lodError: number,
  parentError: number | null,
  parentSphere: number[] | null,
) => ({
  id,
  url: String(id),
  triangles: 1,
  depthLayer: 0,
  min: boite.min,
  max: boite.max,
  sphere: boite.sphere,
  lodError,
  parentError,
  parentSphere,
  matrix: world,
  material: surfaceOf(material),
});
const pages = [
  page(0, boiteGrossier, EPS, null, null),
  page(1, boiteFin, 0, EPS, boiteGrossier.sphere),
];
/** A leaf node that stores the two clusters: box, sphere, missing replacement (−1). */
const nodes = new Float64Array(15);
nodes.set([...boiteGrossier.min, ...boiteGrossier.max, ...boiteGrossier.sphere, -1, 0, 0, 0, 2]);
const culling = { nodes, stride: 15 };

function coupeCpu(avecNoeud: boolean): string[] {
  const root = {
    world,
    pages,
    cones: false,
    culling: avecNoeud ? { ...culling, bounds: cullingBounds(culling, pages) } : undefined,
  };
  const { shown } = selectVisiblePages([root], cameraMoteur(camera), {
    pixelError: SEUIL,
    viewport: VIEWPORT,
  });
  return shown.map((rec) => (rec.id === 0 ? 'coarse' : 'fine'));
}
const name = (ids: number[]): string[] => ids.map((i) => (i === 0 ? 'coarse' : 'fine'));

const uniforms = cameraSelectionUniforms(cameraMoteur(camera), SEUIL, VIEWPORT);
const empaquete = (avecNoeud: boolean) =>
  // The kernel works in the render frame: packed world matrices are brought to the eye, as the
  // engine carries them, otherwise relative view and absolute world would mix.
  packedWorldsToRenderOrigin(
    packDagSelection([{ world, pages, culling: avecNoeud ? culling : undefined }]),
    [{ world, pages: [] }],
    uniforms.cameraWorld,
  );
const aPlat = empaquete(false),
  avecNoeud = empaquete(true);
const gpu = await selectionGpu([
  { name: 'aPlat', packed: aPlat, uniforms },
  { name: 'avecNoeud', packed: avecNoeud, uniforms },
]);
const pagesGpu = (cas: string): string[] | null => {
  const pagesLues = gpu.resultats?.find((r) => r.name === cas)?.pages;
  return pagesLues ? name(pagesLues) : null;
};
const rapport = {
  epsilon: EPS,
  focalePixels: focal,
  deplacementReelPixels: reel(),
  annonceCpuPixels: projectedClusterError(
    EPS,
    boiteGrossier.sphere,
    0,
    camera.matrixWorldInverse.elements,
    1,
    focal,
    camera.near,
  ),
  seuil: SEUIL,
  cpu: { aPlat: coupeCpu(false), avecNoeud: coupeCpu(true) },
  oracleNoyau: {
    aPlat: name(evaluateDagSelectionKernel(aPlat, uniforms).pageIds),
    avecNoeud: name(evaluateDagSelectionKernel(avecNoeud, uniforms).pageIds),
  },
  gpu: {
    adaptateur: gpu.adaptateur ?? null,
    erreurs: [...(gpu.compilation ?? []), ...(gpu.erreurs ?? [])],
    indisponible: gpu.indisponible ?? null,
    aPlat: pagesGpu('aPlat'),
    avecNoeud: pagesGpu('avecNoeud'),
  },
};
console.log(JSON.stringify(rapport, null, 2));

assert.ok(rapport.deplacementReelPixels > SEUIL, 'the case must actually exceed the threshold');
assert.equal(rapport.gpu.indisponible, null);
assert.deepEqual(rapport.gpu.erreurs, []);
assert.ok(rapport.annonceCpuPixels >= rapport.deplacementReelPixels, 'CPU: underestimated error');
for (const [side, outputs] of Object.entries({
  cpu: rapport.cpu,
  oracleNoyau: rapport.oracleNoyau,
  gpu: rapport.gpu,
}))
  for (const cas of ['aPlat', 'avecNoeud'] as const)
    assert.deepEqual(
      outputs[cas],
      ['fine'],
      `${side} ${cas}: the coarse cluster is wrongly accepted`,
    );
