// the autonomous backend detaches by cut delta instead of sweeping the whole DAG.
import { GraphScene } from '../../../packages/sdk-browser/src/host/graph/scene.ts';
import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts';
import { surfaceOf } from '../../../packages/sdk-browser/src/page/surface.ts';
import { createAutonomousGeometry } from '../../../packages/sdk-browser/src/backend/autonomous/geometry.ts';
import type { PageRec } from '../../../packages/sdk-browser/src/page/selection/selection.ts';
import { graine, mesure, stress, rapport } from '../../core/index.ts';
import { referenceAutonomousSync } from '../../oracles/browser/autonomous-backend.ts';
import { HOSTILE_FLOATS } from '../../../tests/kit/assert/hostile.ts';

const HOSTILES = [...HOSTILE_FLOATS, 1.7976931348623157e308];
const geometrie = new G.GraphGeometry();
const materiau = G.basicSurface();

interface Monde {
  scene: GraphScene;
  allPages: PageRec[];
  shown: PageRec[];
  desired: PageRec[];
}

function monde(total: number, depart: number): Monde {
  const alea = graine(depart);
  const scene = new GraphScene(),
    allPages: PageRec[] = [];
  for (let i = 0; i < total; i++)
    allPages.push({
      id: i,
      url: `p${i}`,
      clusterId: `p${i}`,
      attached: false,
      mesh: undefined,
      geometry: geometrie,
      material: surfaceOf(materiau),
      declaration: materiau,
      renderOrder: i,
      matrix: new G.Matrix4().makeTranslation(alea(), alea(), alea()),
      array: new Uint32Array(3),
      triangles: i < HOSTILES.length ? HOSTILES[i] : Math.floor(alea() * 400),
      // The exercised sync() path never reads these; filled with real, harmless values so the
      // fixture is a genuine `PageRec` instead of a cast TypeScript cannot verify.
      indexBytes: 0,
      min: [0, 0, 0],
      max: [0, 0, 0],
      depthLayer: 0,
      attributes: geometrie.attributes,
    });
  return { scene, allPages, shown: [], desired: [] };
}

const empreinte = (m: Monde, triangles: number) => ({
  enfants: m.scene.children.map((mesh) => mesh.renderOrder),
  triangles,
});

function coupes(total: number, tailles: readonly number[], depart: number) {
  const alea = graine(depart);
  return tailles.map((size) => {
    const cut: number[] = [];
    for (let i = 0; i < size; i++) cut.push(Math.floor(alea() * total) % Math.max(1, total));
    return [...new Set(cut)];
  });
}

const passe = (
  m: Monde,
  sync: () => void,
  etat: { submittedTriangles: number },
  suite: readonly number[][],
) =>
  suite.map((indices) => {
    m.shown.length = 0;
    for (const index of indices) m.shown.push(m.allPages[index]);
    sync();
    return empreinte(m, etat.submittedTriangles);
  });

function cas(name: string, total: number, tailles: readonly number[], mesure = true) {
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
  fichier: 'packages/sdk-browser/src/backend/autonomous/geometry.ts',
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
  calcul: (m: Monde) =>
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
    { name: 'empty', input: { scene: new GraphScene(), allPages: [], shown: [], desired: [] } },
  ],
});

rapport(
  'backend-autonome',
  [resAutonome],
  'G1 attaches and detaches the exact same pages, in the same scene order',
);
