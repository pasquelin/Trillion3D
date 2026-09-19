// the autonomous backend detaches by cut delta instead of sweeping the whole DAG.
import * as THREE from 'three';
import { createAutonomousGeometry } from '../autonomousGeometry.ts';
import { graine, mesure, stress, rapport } from '../../sdk-core/bench/socle.mjs';
import { referenceAutonomousSync } from './oracles/backend-autonome.mjs';

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
  return tailles.map((size) => {
    const cut = [];
    for (let i = 0; i < size; i++) cut.push(Math.floor(alea() * total) % Math.max(1, total));
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

function cas(name, total, tailles, mesure = true) {
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
    name,
    size: total,
    mesure,
    input: {
      reference: () => passe(gauche, oracle.sync, oracle.state, suite),
      optimisee: () => passe(droite, paquet.sync, paquet.state, suite),
    },
  };
}

const resAutonome = await mesure({
  name: 'autonomous backend cut',
  fichier: 'packages/sdk-browser/autonomousGeometry.ts',
  cas: [
    cas('20 000 pages, cuts of 200', 20000, [200, 200, 200, 200]),
    cas('4 000 pages, full cut then empty', 4000, [4000, 0, 4000, 0]),
    cas('a single page', 1, [1, 0, 1]),
    cas('no pages', 0, [0, 0]),
    cas('seven pages with hostile triangles', 7, [7, 3, 7, 0]),
  ],
  calcul: (input) => input.optimisee(),
  attendu: (input) => input.reference(),
  options: { tours: 30, budgetMs: 1500 },
});

await stress({
  name: 'createAutonomousGeometry extremes',
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
  extremes: [
    { name: 'empty', input: { scene: new THREE.Scene(), allPages: [], shown: [], desired: [] } },
  ],
});

rapport(
  'backend-autonome',
  [resAutonome],
  'G1 attaches and detaches the exact same pages, in the same scene order',
);
