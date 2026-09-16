// A9 et A10 : le sens de parcours d'un cluster, et la caméra gardée pour comparer deux vues.
// Référence = `webgpuPagesPipelineFor.ts:22-30` et `webgpuPagesRender.ts:32-35` d'avant le lot A.
import * as THREE from 'three';
import { sameHizView } from '../hizTemporal.ts';
import { setWindingEpoch, windingCw } from '../webgpuPagesWinding.ts';
import { compare, graine, verifieEtDepose } from '../../sdk-core/bench/banc.mjs';
import { referenceWindingCw } from './oracles/pages.mjs';
import { createEngineCamera, holdCameraWorld, readCameraWorld } from '../cameraWorld.ts';

const alea = graine(67);
/** Des clusters posés au hasard, dont un sur sept est réfléchi : son sens de parcours s'inverse. */
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

// Quatre lectures par page et par image : les chemins de dessin en demandent jusque-là.
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
// La caméra du moteur de l'image en cours, réécrite comme le fait une entrée d'image.
const courante = createEngineCamera();
let gardeeReference,
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
// La référence alloue une caméra du moteur par image ; l'optimisée recopie dans celle qu'elle garde.
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

const lignes = [
  await compare({
    calcul: 'A9 windingCw',
    fichier: 'packages/sdk-browser/webgpuPagesWinding.ts',
    cas: [
      { nom: '20 000 clusters, 4 lectures', entree: gros, taille: gros.length },
      { nom: 'un cluster', entree: seul, taille: 1 },
      { nom: 'aucun cluster', entree: [], taille: 0 },
    ],
    reference: imageDeSens(referenceWindingCw, false),
    optimisee: imageDeSens(windingCw, true),
    options: { tours: 200, budgetMs: 2000 },
  }),
  await compare({
    calcul: 'A10 caméra de comparaison',
    fichier: 'packages/sdk-browser/webgpuPagesRender.ts',
    cas: [
      { nom: '400 images', entree: 400, taille: 400 },
      { nom: 'une image', entree: 1, taille: 1 },
    ],
    reference: referenceVue,
    optimisee: optimiseeVue,
    options: { tours: 200, budgetMs: 2000 },
  }),
];

verifieEtDepose('pages', 'A9 et A10 rendent exactement les mêmes verdicts', lignes);
