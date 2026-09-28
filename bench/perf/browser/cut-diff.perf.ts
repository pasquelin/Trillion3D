// GEO-1: cut readers by delta. The budget ranking left with #974: both cuts rank by admission.
import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts';
import { surfaceOf } from '../../../packages/sdk-browser/src/page/surface.ts';
import {
  RequestStamps,
  collectPendingUrls,
} from '../../../packages/sdk-browser/src/page/selection/selection.ts';
import type { PageRec } from '../../../packages/sdk-browser/src/page/selection/selection.ts';
import { createCutDelta } from '../../../packages/sdk-browser/src/webgpu/cut/delta.ts';
import { createCutPending } from '../../../packages/sdk-browser/src/webgpu/cut/pending.ts';
import { graine, mesure, stress, rapport } from '../../core/index.ts';
import { referenceCutComplete, referencePendingUrls } from '../../oracles/browser/cut-diff.ts';

const alea = graine(97);
const PAGES = 160000,
  COUPE = 20000,
  NIVEAUX = 13;
const niveaux = new Int32Array(PAGES);
for (let k = 0; k < PAGES; k++) niveaux[k] = Math.floor(alea() * NIVEAUX);
/** Fields the cut readers never touch: shared across every record, never mutated. */
const DUMMY_MATRIX = new G.Matrix4();
const DUMMY_ATTRIBUTES: G.Geometry['attributes'] = {};
const DUMMY_BOUNDS: number[] = [0, 0, 0];
const pages: PageRec[] = [];
for (let i = 0; i < PAGES; i++)
  pages.push({
    id: i,
    url: `p${i >> 1}`,
    clusterId: `p${i >> 1}`,
    requestIndex: i >> 1,
    keyIndex: i >> 1,
    packedIndex: i,
    level: niveaux[i >> 1],
    triangles: 1 + Math.floor(alea() * 128),
    indexBytes: 0,
    min: DUMMY_BOUNDS,
    max: DUMMY_BOUNDS,
    depthLayer: 0,
    attributes: DUMMY_ATTRIBUTES,
    material: surfaceOf([]),
    declaration: [],
    matrix: DUMMY_MATRIX,
    renderOrder: 0,
    attached: true,
    transparent: alea() < 0.1,
    array: alea() < 0.995 ? new Uint32Array(3) : undefined,
  });

const fenetre = (depart: number) => {
  const ids: number[] = [];
  for (let k = 0; k < COUPE; k++) ids.push((depart + k) % PAGES);
  ids.sort((a, b) => a - b);
  return ids;
};
const glisse = [0, 1000, 2000, 3000, 4000, 3000, 2000, 1000].map(fenetre);
const immobile = Array.from({ length: 8 }, () => glisse[0]);
const saut = Array.from({ length: 8 }, (_, image) => fenetre(image * 40000 + 7));

const regimes: [string, number[][]][] = [
  ['glisse', glisse],
  ['immobile', immobile],
  ['saut', saut],
];

const stampsReference = new RequestStamps(PAGES),
  stampsOptimisee = new RequestStamps(PAGES);
const scratchReference: string[] = [],
  scratchOptimisee: string[] = [];
const desiredReference: PageRec[] = [],
  deltaReference = createCutDelta(pages, desiredReference);
const desiredOptimisee: PageRec[] = [],
  deltaOptimisee = createCutDelta(pages, desiredOptimisee);
const pending = createCutPending(pages, deltaOptimisee);

const lecteursReference = (images: number[][]) => {
  const output = [];
  for (const ids of images) {
    deltaReference.apply(ids);
    const complete = referenceCutComplete(desiredReference);
    const attendues = referencePendingUrls(desiredReference, stampsReference, scratchReference);
    output.push({ complete, attendues: attendues.length });
  }
  return output;
};
const lecteursOptimisee = (images: number[][]) => {
  const output = [];
  for (const ids of images) {
    deltaOptimisee.apply(ids);
    pending.apply();
    const complete = pending.count === 0;
    const attendues = collectPendingUrls(pending.records, scratchOptimisee, stampsOptimisee);
    output.push({ complete, attendues: attendues.length });
  }
  return output;
};

const mesuresResultats = [];
for (const [regime, images] of regimes) {
  mesuresResultats.push(
    await mesure({
      name: `cut readers ${regime}`,
      fichier: 'packages/sdk-browser/src/webgpu/cut/pending.ts',
      cas: [{ name: `8 frames ${regime}`, input: images, size: COUPE * 8 }],
      calcul: lecteursOptimisee,
      attendu: lecteursReference,
      options: { tours: 20, budgetMs: 1500 },
    }),
  );
}

await stress({
  name: 'createCutDelta extremes',
  calcul: (arr: PageRec[]) => createCutDelta(arr).apply([]),
  extremes: [{ name: 'empty', input: [] }],
});

rapport('coupe-difference', mesuresResultats, 'GEO-1: cut readers yield the same verdicts');
