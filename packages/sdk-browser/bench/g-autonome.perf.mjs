// G1 : le backend autonome détache par le delta de la coupe au lieu de balayer tout le DAG.
import * as THREE from 'three';
import { createAutonomousGeometry } from '../autonomousGeometry.ts';
import { graine, mesure, stress, rapport } from '../../sdk-core/bench/mesure.mjs';
import { referenceAutonomousSync } from './oracles/g-autonome.mjs';

const HOSTILES = [0, -0, NaN, Infinity, -Infinity, 5e-324, 1.7976931348623157e308];
const geometrie = new THREE.BufferGeometry();
const materiau = new THREE.MeshBasicMaterial();

function monde(total, depart) {
  const alea = graine(depart);
  const scene = new THREE.Scene(),
    allPages = [];
  for (let i = 0; i < total; i++)
    allPages.push({
      id: i,
      attached: false,
      mesh: undefined,
      geometry: geometrie,
      material: materiau,
      renderOrder: i,
      matrix: new THREE.Matrix4().makeTranslation(alea(), alea(), alea()),
      array: new Uint32Array(3),
      triangles: i < HOSTILES.length ? HOSTILES[i] : Math.floor(alea() * 400),
    });
  return { scene, allPages, shown: [], desired: [] };
}

const empreinte = (m, triangles) => ({
  enfants: m.scene.children.map((mesh) => mesh.renderOrder),
  triangles,
});

function coupes(total, tailles, depart) {
  const alea = graine(depart);
  return tailles.map((taille) => {
    const cut = [];
    for (let i = 0; i < taille; i++) cut.push(Math.floor(alea() * total) % Math.max(1, total));
    return [...new Set(cut)];
  });
}

const passe = (m, sync, etat, suite) =>
  suite.map((indices) => {
    m.shown.length = 0;
    for (const index of indices) m.shown.push(m.allPages[index]);
    sync();
    return empreinte(m, etat.submittedTriangles);
  });

function cas(nom, total, tailles, mesure = true) {
  const suite = coupes(total, tailles, 0x5eed ^ total);
  const gauche = monde(total, 0x9e37 ^ total),
    droite = monde(total, 0x9e37 ^ total);
  const oracle = referenceAutonomousSync(gauche);
  const paquet = createAutonomousGeometry({
    ...droite,
    bootstrap: [],
    byUrl: new Map(),
    descriptors: new Map(),
    baseMaterials: new Map(),
    colorMaterials: new Map(),
    modifiedPages: new Set(),
  });
  return {
    nom,
    taille: total,
    mesure,
    entree: {
      reference: () => passe(gauche, oracle.sync, oracle.state, suite),
      optimisee: () => passe(droite, paquet.sync, paquet.state, suite),
    },
  };
}

const resAutonome = await mesure({
  nom: 'G1 coupe du backend autonome',
  fichier: 'packages/sdk-browser/autonomousGeometry.ts',
  cas: [
    cas('20 000 pages, coupes de 200', 20000, [200, 200, 200, 200]),
    cas('4 000 pages, coupe entière puis vide', 4000, [4000, 0, 4000, 0]),
    cas('une seule page', 1, [1, 0, 1]),
    cas('aucune page', 0, [0, 0]),
    cas('sept pages aux triangles hostiles', 7, [7, 3, 7, 0]),
  ],
  calcul: (entree) => entree.optimisee(),
  attendu: (entree) => entree.reference(),
  options: { tours: 30, budgetMs: 1500 },
});

await stress({
  nom: 'createAutonomousGeometry extremes',
  calcul: (m) =>
    createAutonomousGeometry({
      ...m,
      bootstrap: [],
      byUrl: new Map(),
      descriptors: new Map(),
      baseMaterials: new Map(),
      colorMaterials: new Map(),
      modifiedPages: new Set(),
    }).sync(),
  extremes: [{ nom: 'vide', entree: { scene: new THREE.Scene(), allPages: [], shown: [], desired: [] } }],
});

rapport(
  'g-autonome',
  [resAutonome],
  'G1 attache et détache exactement les mêmes pages, dans le même ordre de scène',
);
