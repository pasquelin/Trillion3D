// winding of a cluster and view-camera comparison.
import * as THREE from 'three';
import { sameHizView } from '../hizTemporal.ts';
import { setWindingEpoch, windingCw } from '../webgpuPagesWinding.ts';
import { graine, mesure, stress, rapport } from '../../sdk-core/bench/socle.ts';
import { referenceWindingCw } from './oracles/pages-webgpu.ts';
import { createEngineCamera, holdCameraWorld, readCameraWorld } from '../cameraWorld.ts';
import type { EngineCamera } from '../engineCamera.ts';
import type { PageRec } from '../pageSelectionTypes.ts';

const alea = graine(67);

/** Fields the winding test never reads: shared across every fixture record. */
const DUMMY_ATTRIBUTES: THREE.BufferGeometry['attributes'] = {};
const DUMMY_BOUNDS: number[] = [0, 0, 0];
const pageOf = (matrix: THREE.Matrix4): PageRec => ({
  id: 0,
  url: '',
  clusterId: '',
  triangles: 0,
  indexBytes: 0,
  min: DUMMY_BOUNDS,
  max: DUMMY_BOUNDS,
  depthLayer: 0,
  attributes: DUMMY_ATTRIBUTES,
  material: [],
  matrix,
  renderOrder: 0,
  attached: true,
});

function clusters(nombre: number): PageRec[] {
  const recs: PageRec[] = [];
  for (let i = 0; i < nombre; i++) {
    const matrix = new THREE.Matrix4().compose(
      new THREE.Vector3((alea() - 0.5) * 40, (alea() - 0.5) * 20, -alea() * 60),
      new THREE.Quaternion().setFromEuler(
        new THREE.Euler(alea() * 6.28, alea() * 6.28, alea() * 6.28),
      ),
      new THREE.Vector3(1, 1, i % 7 ? 1 : -1),
    );
    recs.push(pageOf(matrix));
  }
  return recs;
}
const gros = clusters(20000),
  seul = clusters(1);

const LECTURES = 4;
let epoque = 0;
const imageDeSens = (sens: (rec: PageRec) => boolean, pose: boolean) => (recs: PageRec[]) => {
  epoque++;
  if (pose) setWindingEpoch(epoque);
  const verdicts = new Uint8Array(recs.length * LECTURES);
  for (let lecture = 0; lecture < LECTURES; lecture++)
    for (let i = 0; i < recs.length; i++)
      verdicts[lecture * recs.length + i] = sens(recs[i]) ? 1 : 0;
  return verdicts;
};

const vue = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 200);
const courante = createEngineCamera();
let gardeeReference: EngineCamera | undefined = undefined,
  gardeeOptimisee: EngineCamera | undefined = undefined;
const parcoursDeVue =
  (garder: (camera: THREE.PerspectiveCamera) => boolean) => (images: number) => {
    const verdicts = new Uint8Array(images),
      elements = new Float64Array(16);
    for (let image = 0; image < images; image++) {
      vue.position.set(Math.sin(image * 0.01) * 3, 0, 6 + image * 0.001);
      vue.updateMatrixWorld();
      verdicts[image] = garder(vue) ? 1 : 0;
    }
    elements.set(vue.matrixWorldInverse.elements);
    return { verdicts, elements };
  };

const referenceVue = parcoursDeVue((camera) => {
  const lue = readCameraWorld(courante, camera);
  const verdict = sameHizView(gardeeReference, lue);
  gardeeReference = holdCameraWorld(createEngineCamera(), lue);
  return verdict;
});

const optimiseeVue = parcoursDeVue((camera) => {
  const lue = readCameraWorld(courante, camera);
  const verdict = sameHizView(gardeeOptimisee, lue);
  gardeeOptimisee = holdCameraWorld(gardeeOptimisee ?? createEngineCamera(), lue);
  return verdict;
});

const resWinding = await mesure({
  name: 'windingCw',
  fichier: 'packages/sdk-browser/webgpuPagesWinding.ts',
  cas: [
    { name: '20 000 clusters, 4 reads', input: gros, size: gros.length },
    { name: 'one cluster', input: seul, size: 1 },
    { name: 'no clusters', input: [], size: 0 },
  ],
  calcul: imageDeSens(windingCw, true),
  attendu: imageDeSens(referenceWindingCw, false),
  options: { tours: 100, budgetMs: 1500 },
});

const resSameView = await mesure({
  name: 'comparison camera',
  fichier: 'packages/sdk-browser/webgpuPagesRender.ts',
  cas: [
    { name: '400 frames', input: 400, size: 400 },
    { name: 'one frame', input: 1, size: 1 },
  ],
  calcul: optimiseeVue,
  attendu: referenceVue,
  options: { tours: 60, budgetMs: 1500 },
});

await stress({
  name: 'windingCw extremes',
  calcul: (c: PageRec) => windingCw(c),
  extremes: [
    {
      name: 'zero matrix',
      input: pageOf(new THREE.Matrix4().set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)),
    },
    { name: 'negative scale', input: pageOf(new THREE.Matrix4().makeScale(-1, -1, -1)) },
  ],
});

rapport('pages-webgpu', [resWinding, resSameView], 'A9 and A10 yield the exact same values');
