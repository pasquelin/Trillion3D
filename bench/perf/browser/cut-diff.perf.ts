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
import { xorshiftRandom, measure, stress, rapport } from '../../core/index.ts';
import { referenceCutComplete, referencePendingUrls } from '../../oracles/browser/cut-diff.ts';

const alea = xorshiftRandom(97);
const PAGES = 160000,
  COUPE = 20000,
  LEVELS = 13;
const levels = new Int32Array(PAGES);
for (let k = 0; k < PAGES; k++) levels[k] = Math.floor(alea() * LEVELS);
/** Fields the cut readers never touch: shared across every record, never mutated. */
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
    level: levels[i >> 1],
    triangles: 1 + Math.floor(alea() * 128),
    indexBytes: 0,
    min: DUMMY_BOUNDS,
    max: DUMMY_BOUNDS,
    depthLayer: 0,
    attributes: DUMMY_ATTRIBUTES,
    material: surfaceOf([]),
    declaration: [],
    renderOrder: 0,
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
  optimisedStamps = new RequestStamps(PAGES);
const scratchReference: string[] = [],
  optimisedScratch: string[] = [];
const desiredReference: PageRec[] = [],
  deltaReference = createCutDelta(pages, desiredReference);
const optimisedDesired: PageRec[] = [],
  optimisedDelta = createCutDelta(pages, optimisedDesired);
const pending = createCutPending(pages, optimisedDelta);

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
const optimisedReaders = (images: number[][]) => {
  const output = [];
  for (const ids of images) {
    optimisedDelta.apply(ids);
    pending.apply();
    const complete = pending.count === 0;
    const attendues = collectPendingUrls(pending.records, optimisedScratch, optimisedStamps);
    output.push({ complete, attendues: attendues.length });
  }
  return output;
};

const measurementResults = [];
for (const [regime, images] of regimes) {
  measurementResults.push(
    await measure({
      name: `cut readers ${regime}`,
      fichier: 'packages/sdk-browser/src/webgpu/cut/pending.ts',
      cas: [{ name: `8 frames ${regime}`, input: images, size: COUPE * 8 }],
      calculation: optimisedReaders,
      expected: lecteursReference,
      options: { tours: 20, budgetMs: 1500 },
    }),
  );
}

await stress({
  name: 'createCutDelta extremes',
  calculation: (arr: PageRec[]) => createCutDelta(arr).apply([]),
  extremes: [{ name: 'empty', input: [] }],
});

rapport('coupe-difference', measurementResults, 'GEO-1: cut readers yield the same verdicts');
