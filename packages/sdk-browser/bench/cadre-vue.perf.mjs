// ce qu'une image rebâtissait sans raison.
import * as THREE from 'three';
import { surfaceColorAttachments } from '../webgpuPagesEncodeVisSetup.ts';
import { anneauFroid } from '../explorerDraw.ts';
import { deplaceInstance } from '../autonomousInstances.ts';
import { mesure, stress, rapport } from '../../sdk-core/bench/socle.mjs';
import {
  referenceAnneauFroid,
  referenceAttachments,
  referenceUpdateInstance,
} from './oracles/cadre-vue.mjs';

const vues = (etiquette) => [0, 1, 2, 3].map((i) => ({ surface: `${etiquette}/${i}` }));
const surfaces = (etiquette) => {
  const liste = vues(etiquette);
  return { views: () => liste };
};
const petite = surfaces('720p'),
  grande = surfaces('1440p');
const liberee = {
  views: () => {
    throw new Error('SURFACE_DISPOSED');
  },
};

const passeAttachments = (fn) => (entree) => {
  const sortie = [];
  for (const cible of entree) {
    try {
      sortie.push(fn(cible).map((item) => ({ ...item, clearValue: [...item.clearValue] })));
    } catch (erreur) {
      sortie.push(erreur.message);
    }
  }
  return sortie;
};

const imagesSurfaces = [];
for (let i = 0; i < 2000; i++) imagesSurfaces.push(petite);
const redimensionnee = [petite, petite, grande, grande, petite, liberee, grande];

const instanceDe = (pages) => {
  const basePages = [],
    baseRoots = [],
    clones = [],
    racines = [];
  for (let i = 0; i < pages; i++) {
    basePages.push({ matrix: new THREE.Matrix4().makeTranslation(i, i * 2, i * 3) });
    clones.push({
      matrix: new THREE.Matrix4(),
      mesh: i % 3 ? { matrix: new THREE.Matrix4() } : undefined,
    });
  }
  for (let i = 0; i < 10; i++) {
    baseRoots.push({ world: new THREE.Matrix4().makeScale(1 + i, 2, 3) });
    racines.push({ world: new THREE.Matrix4() });
  }
  return { basePages, baseRoots, instance: { pages: clones, bases: basePages, roots: racines } };
};
const petiteInstance = instanceDe(100),
  grosseInstance = instanceDe(5000);
const transformation = new THREE.Matrix4()
  .makeRotationY(0.7)
  .multiply(new THREE.Matrix4().makeTranslation(3, -1, 2));

const passeInstance = (fn) => (entree) => {
  const { basePages, baseRoots, instance } = entree;
  fn(instance, basePages, baseRoots, transformation);
  const sortie = [];
  for (const rec of instance.pages)
    sortie.push(...rec.matrix.elements, ...(rec.mesh?.matrix.elements ?? []));
  for (const root of instance.roots) sortie.push(...root.world.elements);
  return Float64Array.from(sortie);
};

const anneau = [];
for (let i = 0; i < 10000; i++) anneau.push(`bundle/${i}`);
const tenues = new Set(anneau.filter((_, i) => i % 30 !== 0));
const streamer = {
  has: (url) => tenues.has(url),
  loading: () => false,
  failed: (url) => url.endsWith('7777'),
};

const resAttachments = await mesure({
  nom: 'pièces jointes des surfaces',
  fichier: 'packages/sdk-browser/webgpuPagesEncodeVisSetup.ts',
  cas: [
    { nom: '2 000 images sans redimensionnement', entree: imagesSurfaces, taille: 2000 },
    { nom: 'redimensionnements et cible libérée', entree: redimensionnee, taille: 7 },
  ],
  calcul: passeAttachments(surfaceColorAttachments),
  attendu: passeAttachments(referenceAttachments),
  options: { tours: 100, budgetMs: 1500 },
});

const resInstance = await mesure({
  nom: 'déplacement d’une instance',
  fichier: 'packages/sdk-browser/autonomousInstances.ts',
  cas: [
    { nom: '5 000 pages', entree: grosseInstance, taille: 5000 },
    { nom: '100 pages', entree: petiteInstance, taille: 100 },
  ],
  calcul: passeInstance((inst, _bases, racines, t) => deplaceInstance(inst, racines, t)),
  attendu: passeInstance(referenceUpdateInstance),
  options: { tours: 100, budgetMs: 1500 },
});

const resAnneau = await mesure({
  nom: 'anneau du cadre de vue',
  fichier: 'packages/sdk-browser/explorerDraw.ts',
  cas: [
    {
      nom: '10 000 adresses, lot de 64',
      entree: { ring: anneau, streamer, limite: 64 },
      taille: 10000,
    },
  ],
  calcul: (e) => anneauFroid(e.ring, e.streamer, e.limite),
  attendu: (e) => referenceAnneauFroid(e.ring, e.streamer, e.limite),
  options: { tours: 100, budgetMs: 1500 },
});

await stress({
  nom: 'anneauFroid extremes',
  calcul: (lim) => anneauFroid([], streamer, lim),
  extremes: [
    { nom: '0 limite', entree: 0 },
    { nom: 'negative limite', entree: -1 },
  ],
});

rapport(
  'cadre-vue',
  [resAttachments, resInstance, resAnneau],
  'F10, F12 et F13 rendent exactement les mêmes descripteurs, matrices et listes',
);
