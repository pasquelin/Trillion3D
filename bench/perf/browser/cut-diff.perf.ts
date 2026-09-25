// GEO-1: cut readers and budget ranking by delta.
import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts';
import { surfaceOf } from '../../../packages/sdk-browser/src/page/surface.ts';
import {
  RequestStamps,
  collectPendingUrls,
} from '../../../packages/sdk-browser/src/page/selection/selection.ts';
import type { PageRec } from '../../../packages/sdk-browser/src/page/selection/selection.ts';
import {
  createCutDelta,
  type CutDelta,
} from '../../../packages/sdk-browser/src/webgpu/cut/delta.ts';
import { createCutPending } from '../../../packages/sdk-browser/src/webgpu/cut/pending.ts';
import { createBudgetRanking } from '../../../packages/sdk-browser/src/webgpu/residency/budgetRanking.ts';
import { graine, mesure, stress, rapport } from '../../core/index.ts';
import {
  createReferenceRanking,
  levelHistogram,
  referenceCutComplete,
  referencePendingUrls,
} from '../../oracles/browser/cut-diff.ts';

const alea = graine(97);
const PAGES = 160000,
  COUPE = 20000,
  NIVEAUX = 13;
const niveaux = new Int32Array(PAGES);
for (let k = 0; k < PAGES; k++) niveaux[k] = Math.floor(alea() * NIVEAUX);
/** Fields the cut readers never touch: shared across every record, never mutated. */
const DUMMY_MATRIX = new G.Matrix4();
const DUMMY_ATTRIBUTES: G.GraphGeometry['attributes'] = {};
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

/** Ranking surface `classement` needs of either candidate: the real ranking's `rank` takes no
 *  cut, the oracle's does — a shorter parameter list is always assignable to a longer one. */
interface RankingLike {
  readonly keys: Int32Array;
  readonly length: number;
  add(page: PageRec): void;
  remove(page: PageRec): void;
  rank(room: number, cut?: readonly PageRec[]): number;
}

const ROOM = 6000;
const bootstrapKey = new Uint8Array(PAGES);
const keyOf = (page: PageRec) => page.keyIndex ?? 0;
const levelOfKey = new Int32Array(PAGES);
for (const page of pages) levelOfKey[keyOf(page)] = page.level ?? 0;

const rankingReference: RankingLike = createReferenceRanking({
  keyCount: PAGES,
  bootstrapKey,
  keyOf,
});
const ranking: RankingLike = createBudgetRanking({ bootstrapKey, keyOf });
const cutReference: PageRec[] = [];
const deltaReferenceRang = createCutDelta(pages, cutReference),
  deltaRang = createCutDelta(pages);

const classement =
  (classeur: RankingLike, delta: CutDelta, cut: readonly PageRec[] | undefined) =>
  (images: number[][]) => {
    const output = [];
    for (const ids of images) {
      delta.apply(ids);
      for (let i = 0; i < delta.exitedCount; i++) classeur.remove(pages[delta.exited[i]]);
      for (let i = 0; i < delta.enteredCount; i++) classeur.add(pages[delta.entered[i]]);
      const records = classeur.rank(ROOM, cut);
      output.push(
        records <= ROOM
          ? { length: 0, levels: [] }
          : {
              length: classeur.length,
              levels: levelHistogram(classeur.keys, classeur.length, levelOfKey),
            },
      );
    }
    return output;
  };
const classementReference = classement(rankingReference, deltaReferenceRang, cutReference);
const classementOptimisee = classement(ranking, deltaRang, undefined);

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
  mesuresResultats.push(
    await mesure({
      name: `budget ranking ${regime}`,
      fichier: 'packages/sdk-browser/src/webgpu/residency/budgetRanking.ts',
      cas: [{ name: `8 frames budget ${regime}`, input: images, size: COUPE * 8 }],
      calcul: classementOptimisee,
      attendu: classementReference,
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
