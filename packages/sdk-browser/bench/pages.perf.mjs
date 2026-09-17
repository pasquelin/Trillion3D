// A9 et A10 : sens de parcours d'un cluster et comparaison de caméra de vue.
import * as THREE from 'three';
import { sameHizView } from '../hizTemporal.ts';
import { setWindingEpoch, windingCw } from '../webgpuPagesWinding.ts';
import { graine, mesure, stress, rapport } from '../../sdk-core/bench/mesure.mjs';
import { referenceWindingCw } from './oracles/pages.mjs';
import { createEngineCamera, holdCameraWorld, readCameraWorld } from '../cameraWorld.ts';

const alea = graine(67);
function clusters(nombre) {
  const recs = [];
  for (let i = 0; i < nombre; i++) {
    const matrix = new THREE.Matrix4().compose(
      new THREE.Vector3((alea() - 0.5) * 40, (alea() - 0.5) * 20, -alea() * 60),
      new THREE.Quaternion().setFromEuler(
        new THREE.Euler(alea() * 6.28, alea() * 6.28, alea() * 6.28),
      ),
      new THREE.Vector3(1, 1, i % 7 ? 1 : -1),
    );
    recs.push({ matrix });
  }
  return recs;
}
const gros = clusters(20000),
  seul = clusters(1);

const LECTURES = 4;
let epoque = 0;
const imageDeSens = (sens, pose) => (recs) => {
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
let gardeeReference = undefined,
  gardeeOptimisee = undefined;
const parcoursDeVue = (garder) => (images) => {
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
  nom: 'A9 windingCw',
  fichier: 'packages/sdk-browser/webgpuPagesWinding.ts',
  cas: [
    { nom: '20 000 clusters, 4 lectures', entree: gros, taille: gros.length },
    { nom: 'un cluster', entree: seul, taille: 1 },
    { nom: 'aucun cluster', entree: [], taille: 0 },
  ],
  calcul: imageDeSens(windingCw, true),
  attendu: imageDeSens(referenceWindingCw, false),
  options: { tours: 100, budgetMs: 1500 },
});

const resSameView = await mesure({
  nom: 'A10 caméra de comparaison',
  fichier: 'packages/sdk-browser/webgpuPagesRender.ts',
  cas: [
    { nom: '400 images', entree: 400, taille: 400 },
    { nom: 'une image', entree: 1, taille: 1 },
  ],
  calcul: optimiseeVue,
  attendu: referenceVue,
  options: { tours: 60, budgetMs: 1500 },
});

await stress({
  nom: 'windingCw extremes',
  calcul: (c) => windingCw(c),
  extremes: [
    { nom: 'matrice zero', entree: { matrix: new THREE.Matrix4().set(0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0) } },
    { nom: 'echelle negative', entree: { matrix: new THREE.Matrix4().makeScale(-1, -1, -1) } },
  ],
});

rapport('pages', [resWinding, resSameView], 'A9 et A10 rendent exactement les mêmes valeurs');
