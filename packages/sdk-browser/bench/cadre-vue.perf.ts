// what a frame used to rebuild for no reason.
import * as THREE from 'three';
import { surfaceColorAttachments } from '../webgpuPagesAttachments.ts';
import { anneauFroid } from '../explorerDraw.ts';
import { deplaceInstance } from '../autonomousInstances.ts';
import { mesure, stress, rapport } from '../../sdk-core/bench/socle.ts';
import {
  referenceAnneauFroid,
  referenceAttachments,
  referenceUpdateInstance,
} from './oracles/cadre-vue.ts';

const views = (etiquette) => [0, 1, 2, 3].map((i) => ({ surface: `${etiquette}/${i}` }));
const surfaces = (etiquette) => {
  const liste = views(etiquette);
  return { views: () => liste };
};
const petite = surfaces('720p'),
  grande = surfaces('1440p');
const liberee = {
  views: () => {
    throw new Error('SURFACE_DISPOSED');
  },
};

const passeAttachments = (fn) => (input) => {
  const output = [];
  for (const cible of input) {
    try {
      output.push(fn(cible).map((item) => ({ ...item, clearValue: [...item.clearValue] })));
    } catch (erreur) {
      output.push(erreur.message);
    }
  }
  return output;
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

const passeInstance = (fn) => (input) => {
  const { basePages, baseRoots, instance } = input;
  fn(instance, basePages, baseRoots, transformation);
  const output = [];
  for (const rec of instance.pages)
    output.push(...rec.matrix.elements, ...(rec.mesh?.matrix.elements ?? []));
  for (const root of instance.roots) output.push(...root.world.elements);
  return Float64Array.from(output);
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
  name: 'surface attachments',
  fichier: 'packages/sdk-browser/webgpuPagesEncodeVisSetup.ts',
  cas: [
    { name: '2 000 frames without resize', input: imagesSurfaces, size: 2000 },
    { name: 'resizes and a disposed target', input: redimensionnee, size: 7 },
  ],
  calcul: passeAttachments(surfaceColorAttachments),
  attendu: passeAttachments(referenceAttachments),
  options: { tours: 100, budgetMs: 1500 },
});

const resInstance = await mesure({
  name: 'instance displacement',
  fichier: 'packages/sdk-browser/autonomousInstances.ts',
  cas: [
    { name: '5 000 pages', input: grosseInstance, size: 5000 },
    { name: '100 pages', input: petiteInstance, size: 100 },
  ],
  calcul: passeInstance((inst, _bases, racines, t) => deplaceInstance(inst, racines, t)),
  attendu: passeInstance(referenceUpdateInstance),
  options: { tours: 100, budgetMs: 1500 },
});

const resAnneau = await mesure({
  name: 'view-frame ring',
  fichier: 'packages/sdk-browser/explorerDraw.ts',
  cas: [
    {
      name: '10 000 addresses, batch of 64',
      input: { ring: anneau, streamer, limite: 64 },
      size: 10000,
    },
  ],
  calcul: (e) => anneauFroid(e.ring, e.streamer, e.limite),
  attendu: (e) => referenceAnneauFroid(e.ring, e.streamer, e.limite),
  options: { tours: 100, budgetMs: 1500 },
});

await stress({
  name: 'anneauFroid extremes',
  calcul: (lim) => anneauFroid([], streamer, lim),
  extremes: [
    { name: '0 limite', input: 0 },
    { name: 'negative limite', input: -1 },
  ],
});

rapport(
  'cadre-vue',
  [resAttachments, resInstance, resAnneau],
  'F10, F12 and F13 yield the exact same descriptors, matrices and lists',
);
