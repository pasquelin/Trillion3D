// Absolute selection measurement: frustum clip and autonomous residency. No oracle here: these
// two computations have no prior implementation to confront; their correctness is held by
// `packages/sdk-core/src/math/frustum/box.test.ts` and `packages/sdk-browser/src/backend/autonomous/residency.test.ts`. Each line says so rather than staying silent.
import { GraphScene } from '../../../packages/sdk-browser/src/host/graph/scene.ts';
import * as THREE from 'three';
import { clipPlanesFromMatrix, frustumClipBox } from '../../../packages/sdk-core/src/index.ts';
import { collectPendingUrls } from '../../../packages/sdk-browser/src/page/selection/requests.ts';
import { createAutonomousResidency } from '../../../packages/sdk-browser/src/backend/autonomous/residency.ts';
import { createAutonomousGeometry } from '../../../packages/sdk-browser/src/backend/autonomous/geometry.ts';
import { mesure, rapport, stress } from '../../core/index.ts';
import { boites, camera, type SceneBox } from './support/scenes.ts';
import { pageRecFixture } from './support/pageRecFixture.ts';
import type { PageRec } from '../../../packages/sdk-browser/src/page/selection/types.ts';

const cam = camera(6, 0.1, 16 / 9);
const clip = new THREE.Matrix4().multiplyMatrices(
  new THREE.Matrix4().fromArray(cam.projectionMatrix.elements),
  new THREE.Matrix4().fromArray(cam.matrixWorldInverse.elements),
);
const planes = new Float64Array(24);
clipPlanesFromMatrix(planes, clip.elements);

const boxes = (liste: SceneBox[]) => {
  const plat = new Float64Array(liste.length * 6);
  for (let i = 0; i < liste.length; i++) {
    plat.set(liste[i].min, i * 6);
    plat.set(liste[i].max, i * 6 + 3);
  }
  return plat;
};
const grande = boxes(boites({ count: 20000 })),
  vide = new Float64Array(0);

const clipper = (plat: Float64Array) => {
  const verdicts = new Uint8Array(plat.length / 6);
  for (let i = 0; i < verdicts.length; i++) {
    const b = i * 6;
    verdicts[i] = frustumClipBox(
      planes,
      plat[b],
      plat[b + 1],
      plat[b + 2],
      plat[b + 3],
      plat[b + 4],
      plat[b + 5],
    );
  }
  return verdicts;
};

// ── Mesure frustumClipBox ────────────────────────────────────────────
const clipResult = await mesure({
  name: 'frustumClipBox',
  fichier: 'packages/sdk-core/src/math/frustum/box.ts',
  cas: [
    { name: '20k boxes including degenerates', input: grande, size: 20000 },
    { name: 'no boxes', input: vide, size: 0 },
  ],
  calcul: clipper,
  motif: 'time only — correctness in packages/sdk-core/src/math/frustum/box.test.ts',
  options: { tours: 200, budgetMs: 1000 },
});

// ── Residency measurement ────────────────────────────────────────────
const pageDeHote = (
  url: string,
  streamUrl: string | undefined,
  array: Uint32Array | undefined,
): PageRec => pageRecFixture({ url, streamUrl, array });

function hote(nombre: number) {
  const pages: PageRec[] = [];
  for (let i = 0; i < nombre; i++)
    pages.push(
      pageDeHote(
        `page-${i % Math.max(1, Math.floor(nombre * 0.6))}.bin`,
        i % 5 ? undefined : `bundle-${i % 400}.bin`,
        i % 3 ? undefined : new Uint32Array(3),
      ),
    );
  const obtenu = createAutonomousResidency({
    bootstrapUrls: new Set(pages.slice(0, Math.min(200, nombre)).map((r) => r.url)),
    modifiedPages: new Set(pages.slice(200, 260).map((r) => r.url)),
    shown: pages.slice(0, Math.floor(nombre * 0.4)),
    desired: pages,
    geometryStore: createAutonomousGeometry({
      scene: new GraphScene(),
      allPages: [],
      bootstrap: [],
      shown: [],
      desired: [],
      byUrl: new Map(),
      descriptors: new Map(),
      baseMaterials: new Map(),
      colorMaterials: new Map(),
      modifiedPages: new Set(),
    }),
  });
  return { pages, obtenu, vers: [] as string[] };
}
const grandHote = hote(15000),
  hoteVide = hote(0);

const residenceResult = await mesure({
  name: 'collectPendingUrls',
  fichier: 'packages/sdk-browser/src/page/selection/requests.ts',
  cas: [
    { name: '15k pages', input: grandHote, size: 15000 },
    { name: 'no pages', input: hoteVide, size: 0 },
  ],
  calcul: (h) => ({
    pending: [...h.obtenu.pendingUrls()],
    retained: [...h.obtenu.pageUrls()],
    attente: collectPendingUrls(h.pages, h.vers).slice(),
  }),
  motif: 'time only — correctness in packages/sdk-browser/src/backend/autonomous/residency.test.ts',
  options: { tours: 60, budgetMs: 1000 },
});

// ── Stress testing ───────────────────────────────────────────────────
await stress({
  name: 'frustumClipBox extremes',
  calcul: (e) => frustumClipBox(planes, e[0], e[1], e[2], e[3], e[4], e[5]),
  extremes: [
    { name: 'NaN box', input: [NaN, NaN, NaN, NaN, NaN, NaN] },
    {
      name: 'Infinity box',
      input: [-Infinity, -Infinity, -Infinity, Infinity, Infinity, Infinity],
    },
    { name: 'inverted box', input: [1, 1, 1, -1, -1, -1] },
    { name: 'zero box', input: [0, 0, 0, 0, 0, 0] },
    { name: '-0 box', input: [-0, -0, -0, -0, -0, -0] },
  ],
});

rapport(
  'tronc-residence',
  [clipResult, residenceResult],
  'Selection: frustum clip and residency — absolute measurement',
);
