// GEO-1: cut readers and budget ranking by delta.
import { RequestStamps, collectPendingUrls } from '../pageSelection.ts';
import { createCutDelta } from '../webgpuCutDelta.ts';
import { createCutCounts } from '../webgpuCutCounts.ts';
import { createCutPending } from '../webgpuCutPending.ts';
import { createBudgetRanking } from '../webgpuBudgetRanking.ts';
import { graine, mesure, stress, rapport } from '../../sdk-core/bench/socle.mjs';
import {
  createReferenceRanking,
  levelHistogram,
  referenceCutComplete,
  referenceCutCounts,
  referencePendingUrls,
} from './oracles/coupe-difference.mjs';

const alea = graine(97);
const PAGES = 160000,
  COUPE = 20000,
  NIVEAUX = 13;
const niveaux = new Int32Array(PAGES);
for (let k = 0; k < PAGES; k++) niveaux[k] = Math.floor(alea() * NIVEAUX);
const pages = [];
for (let i = 0; i < PAGES; i++)
  pages.push({
    url: `p${i >> 1}`,
    requestIndex: i >> 1,
    keyIndex: i >> 1,
    packedIndex: i,
    level: niveaux[i >> 1],
    triangles: 1 + Math.floor(alea() * 128),
    transparent: alea() < 0.1,
    array: alea() < 0.995 ? new Uint32Array(3) : undefined,
  });
const residentOffsetWords = new Int32Array(PAGES);
for (let i = 0; i < PAGES; i++) residentOffsetWords[i] = alea() < 0.99 ? i * 4 : -1;

const fenetre = (depart) => {
  const ids = [];
  for (let k = 0; k < COUPE; k++) ids.push((depart + k) % PAGES);
  ids.sort((a, b) => a - b);
  return ids;
};
const glisse = [0, 1000, 2000, 3000, 4000, 3000, 2000, 1000].map(fenetre);
const immobile = Array.from({ length: 8 }, () => glisse[0]);
const saut = Array.from({ length: 8 }, (_, image) => fenetre(image * 40000 + 7));

const regimes = [
  ['glisse', glisse],
  ['immobile', immobile],
  ['saut', saut],
];

const stampsReference = new RequestStamps(PAGES),
  stampsOptimisee = new RequestStamps(PAGES);
const scratchReference = [],
  scratchOptimisee = [];
const desiredReference = [],
  deltaReference = createCutDelta(pages, desiredReference);
const desiredOptimisee = [],
  deltaOptimisee = createCutDelta(pages, desiredOptimisee);
const counts = createCutCounts(pages, residentOffsetWords, deltaOptimisee),
  pending = createCutPending(pages, deltaOptimisee);

const lecteursReference = (images) => {
  const output = [];
  for (const ids of images) {
    deltaReference.apply(ids);
    const totaux = referenceCutCounts(pages, ids, residentOffsetWords);
    const complete = referenceCutComplete(desiredReference);
    const attendues = referencePendingUrls(desiredReference, stampsReference, scratchReference);
    output.push({ totaux, complete, attendues: attendues.length });
  }
  return output;
};
const lecteursOptimisee = (images) => {
  const output = [];
  for (const ids of images) {
    deltaOptimisee.apply(ids);
    const totaux = { ...counts.apply() };
    pending.apply();
    const complete = pending.count === 0;
    const attendues = collectPendingUrls(pending.records, scratchOptimisee, stampsOptimisee);
    output.push({ totaux, complete, attendues: attendues.length });
  }
  return output;
};

const ROOM = 6000;
const bootstrapKey = new Uint8Array(PAGES);
const keyOf = (page) => page.keyIndex;
const levelOfKey = new Int32Array(PAGES);
for (const page of pages) levelOfKey[page.keyIndex] = page.level;

const rankingReference = createReferenceRanking({ keyCount: PAGES, bootstrapKey, keyOf });
const ranking = createBudgetRanking({ keyCount: PAGES, bootstrapKey, keyOf });
const cutReference = [];
const deltaReferenceRang = createCutDelta(pages, cutReference),
  deltaRang = createCutDelta(pages);

const classement = (classeur, delta, cut) => (images) => {
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
      fichier: 'packages/sdk-browser/webgpuCutCounts.ts',
      cas: [{ name: `8 frames ${regime}`, input: images, size: COUPE * 8 }],
      calcul: lecteursOptimisee,
      attendu: lecteursReference,
      options: { tours: 20, budgetMs: 1500 },
    }),
  );
  mesuresResultats.push(
    await mesure({
      name: `budget ranking ${regime}`,
      fichier: 'packages/sdk-browser/webgpuBudgetRanking.ts',
      cas: [{ name: `8 frames budget ${regime}`, input: images, size: COUPE * 8 }],
      calcul: classementOptimisee,
      attendu: classementReference,
      options: { tours: 20, budgetMs: 1500 },
    }),
  );
}

await stress({
  name: 'createCutDelta extremes',
  calcul: (arr) => createCutDelta(arr).apply([]),
  extremes: [{ name: 'empty', input: [] }],
});

rapport('coupe-difference', mesuresResultats, 'GEO-1: cut readers yield the same verdicts');
