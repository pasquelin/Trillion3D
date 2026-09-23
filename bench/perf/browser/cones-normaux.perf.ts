// preparing normal cones and the page catalogue.
import * as THREE from 'three';
import { prepareCones } from '../../../packages/sdk-browser/src/webgpu/pages/prepare/prepare.ts';
import {
  compteMateriauxEtTangentes,
  indexSourceBytes,
} from '../../../packages/sdk-browser/src/webgpu/pages/io/catalogue.ts';
import type { PageRec } from '../../../packages/sdk-browser/src/page/selection/types.ts';
import type { WebgpuPagesRuntime } from '../../../packages/sdk-browser/src/webgpu/pages/runtime.ts';
import { graine, mesure, stress, rapport } from '../../core/index.ts';
import {
  entreeCones,
  referenceCompteMateriauxEtTangentes,
  referenceIndexSourceBytes,
  referencePrepareCones,
} from '../../oracles/browser/cones-normaux.ts';
import { catalogueDePages } from './support/scenesChargement.ts';

/** `entreeCones` builds the oracle's `{setup: {allPages, roots}}` shape, a small fraction of the
 *  real `WebgpuPagesRuntime` — the same bridge `webgpuPagesPrepare.test.ts` already takes for
 *  this pair, since `prepareCones` only ever reads `rt.setup.roots`. */
const runtimeOf = (rt: ReturnType<typeof entreeCones>) => rt as unknown as WebgpuPagesRuntime;

const alea = graine(6151);
const pages = catalogueDePages({ pages: 20000, materiaux: 60 });
const unePage = catalogueDePages({ pages: 1, materiaux: 1, seed: 17 });
const hostiles = catalogueDePages({ pages: 400, materiaux: 8, seed: 23 }).map((rec, i) => {
  if (i % 5 === 0) return { ...rec, array: undefined };
  if (i % 7 === 0) return { ...rec, attributes: {} };
  if (i % 11 === 0) {
    const brut = new Float32Array(192 * 4);
    for (let k = 0; k < brut.length; k++) brut[k] = alea() * 4 - 2;
    const tampon = new THREE.InterleavedBuffer(brut, 4);
    return { ...rec, attributes: { position: new THREE.InterleavedBufferAttribute(tampon, 3, 0) } };
  }
  if (i % 13 === 0) {
    const brut = new Int16Array(192 * 3);
    for (let k = 0; k < brut.length; k++) brut[k] = Math.floor(alea() * 65536) - 32768;
    return { ...rec, attributes: { position: new THREE.BufferAttribute(brut, 3, true) } };
  }
  return rec;
});

const passeCones = (fn: (rt: WebgpuPagesRuntime) => void) => (liste: PageRec[]) => {
  const copies = liste.map((rec) => ({ ...rec, cone: undefined }));
  fn(runtimeOf(entreeCones(copies)));
  return copies.map((rec) => (rec.cone ? Float64Array.from(rec.cone as ArrayLike<number>) : null));
};

const blocs = new Map<string, { hasTangent: boolean }>();
for (let i = 0; i < 4000; i++) blocs.set(`bloc/${i}`, { hasTangent: i % 3 === 0 });
const blocVide = new Map<string, { hasTangent: boolean }>();

const casPages = [
  { name: '20 000 pages, 60 materials', input: pages, size: 20000 },
  { name: 'interleaved, normalized, missing attributes', input: hostiles, size: 400 },
  { name: 'a single page', input: unePage, size: 1 },
  { name: 'no pages', input: [], size: 0 },
];

const resCones = await mesure({
  name: 'page normal cones',
  fichier: 'packages/sdk-browser/src/webgpu/pages/prepare/prepare.ts',
  cas: casPages,
  calcul: passeCones(prepareCones),
  attendu: passeCones(referencePrepareCones),
  options: { tours: 40, budgetMs: 1500 },
});

const resOctets = await mesure({
  name: 'source-byte table',
  fichier: 'packages/sdk-browser/src/webgpu/pages/io/catalogue.ts',
  cas: casPages,
  calcul: indexSourceBytes,
  attendu: referenceIndexSourceBytes,
  options: { tours: 60, budgetMs: 1500 },
});

const resDiagnostic = await mesure({
  name: 'texture diagnostic counters',
  fichier: 'packages/sdk-browser/src/webgpu/pages/io/catalogue.ts',
  cas: [
    { name: '20 000 pages, 4 000 blocks', input: { pages, blocs }, size: 24000 },
    { name: 'no blocks', input: { pages: unePage, blocs: blocVide }, size: 1 },
    { name: 'nothing to count', input: { pages: [], blocs: blocVide }, size: 0 },
  ],
  calcul: (e: { pages: PageRec[]; blocs: Map<string, { hasTangent: boolean }> }) =>
    compteMateriauxEtTangentes(e.pages, e.blocs),
  attendu: (e: { pages: PageRec[]; blocs: Map<string, { hasTangent: boolean }> }) =>
    referenceCompteMateriauxEtTangentes(e.pages, e.blocs),
  options: { tours: 60, budgetMs: 1500 },
});

await stress({
  name: 'prepareCones extremes',
  calcul: (c: PageRec[]) => prepareCones(runtimeOf(entreeCones(c))),
  extremes: [{ name: 'empty', input: [] }],
});

rapport(
  'cones-normaux',
  [resCones, resOctets, resDiagnostic],
  'F18 yields the exact same cones, bytes and counts',
);
