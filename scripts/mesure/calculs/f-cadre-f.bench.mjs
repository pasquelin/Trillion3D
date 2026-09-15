// F10, F12 et F13 : ce qu'une image rebâtissait sans raison. F10 garde les pièces jointes de
// couleur tant que les vues des surfaces ne changent pas — elles ne changent qu'au
// redimensionnement. F12 garde le couple page/page de base dans l'instance. F13 borne l'anneau de
// préchargement et cherche un moteur sans fermeture.
import * as THREE from 'three';
import { surfaceColorAttachments } from '../../../packages/sdk-browser/webgpuPagesEncodeVisSetup.ts';
import { anneauFroid } from '../../../packages/sdk-browser/explorerDraw.ts';
import { deplaceInstance } from '../../../packages/sdk-browser/autonomousInstances.ts';
import { compare, graine } from './banc.mjs';
import { verifieEtDeposeF } from './bancF.mjs';
import {
  referenceAnneauFroid,
  referenceAttachments,
  referenceUpdateInstance,
} from './oracles/f-cadre.mjs';

const alea = graine(1301);

/** Quatre vues de surface : des jetons opaques, exactement ce que le descripteur transporte. */
const vues = (etiquette) => [0, 1, 2, 3].map((i) => ({ surface: `${etiquette}/${i}` }));
const surfaces = (etiquette) => {
  const liste = vues(etiquette);
  return { views: () => liste };
};
const petite = surfaces('720p'),
  grande = surfaces('1440p');
/** Une cible libérée refuse ses vues : la mémoire ne doit pas masquer ce refus. */
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

/** Une instance de cent pages et dix racines, comme un modèle répliqué dans une scène. */
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
  grosseInstance = instanceDe(5000),
  uneSeule = instanceDe(1),
  aucune = instanceDe(0);
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

/** Un anneau de préchargement de dix mille adresses, dont une sur trente est encore froide. */
const anneau = [];
for (let i = 0; i < 10000; i++) anneau.push(`bundle/${i}`);
const tenues = new Set(anneau.filter((_, i) => i % 30 !== 0));
const streamer = {
  has: (url) => tenues.has(url),
  loading: () => false,
  failed: (url) => url.endsWith('7777'),
};
const streamerVide = { has: () => false, loading: () => false, failed: () => false };
const streamerPlein = { has: () => true, loading: () => false, failed: () => false };

const lignes = [
  await compare({
    calcul: 'F10 pièces jointes des surfaces',
    fichier: 'packages/sdk-browser/webgpuPagesEncodeVisSetup.ts',
    cas: [
      { nom: '2 000 images sans redimensionnement', entree: imagesSurfaces, taille: 2000 },
      { nom: 'redimensionnements et cible libérée', entree: redimensionnee, taille: 7 },
      { nom: 'une seule image', entree: [petite], taille: 1 },
      { nom: 'aucune image', entree: [], taille: 0 },
    ],
    reference: passeAttachments(referenceAttachments),
    optimisee: passeAttachments(surfaceColorAttachments),
    options: { tours: 200, budgetMs: 2500 },
  }),
  await compare({
    calcul: 'F12 déplacement d’une instance',
    fichier: 'packages/sdk-browser/autonomousInstances.ts',
    cas: [
      { nom: '5 000 pages', entree: grosseInstance, taille: 5000 },
      { nom: '100 pages', entree: petiteInstance, taille: 100 },
      { nom: 'une seule page', entree: uneSeule, taille: 1 },
      { nom: 'aucune page', entree: aucune, taille: 0 },
    ],
    reference: passeInstance(referenceUpdateInstance),
    optimisee: passeInstance((inst, _bases, racines, t) => deplaceInstance(inst, racines, t)),
    options: { tours: 200, budgetMs: 2500 },
  }),
  await compare({
    calcul: 'F13 anneau de préchargement',
    fichier: 'packages/sdk-browser/explorerDraw.ts',
    cas: [
      {
        nom: '10 000 adresses, lot de 64',
        entree: { ring: anneau, streamer, limite: 64 },
        taille: 10000,
      },
      {
        nom: 'anneau entièrement froid',
        entree: { ring: anneau, streamer: streamerVide, limite: 64 },
        taille: 10000,
      },
      {
        nom: 'anneau entièrement tenu',
        entree: { ring: anneau, streamer: streamerPlein, limite: 64 },
        taille: 10000,
      },
      { nom: 'lot nul', entree: { ring: anneau, streamer, limite: 0 }, taille: 0 },
      { nom: 'anneau vide', entree: { ring: [], streamer, limite: 64 }, taille: 0 },
    ],
    reference: (e) => referenceAnneauFroid(e.ring, e.streamer, e.limite),
    optimisee: (e) => anneauFroid(e.ring, e.streamer, e.limite),
    options: { tours: 200, budgetMs: 2500 },
  }),
];

verifieEtDeposeF(
  'f-cadre',
  'F10, F12 et F13 rendent exactement les mêmes descripteurs, matrices et listes',
  lignes,
);
