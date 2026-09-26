// Bench of the WebGPU engine-prepare catalogue: the source-byte table and the texture diagnostic
// counters, against their batch F oracles. (The normal cones it also measured are cooked by the
// compiler since #272: the prepare no longer computes them.)
import {
  compteMateriauxEtTangentes,
  indexSourceBytes,
} from '../../../packages/sdk-browser/src/webgpu/pages/io/catalogue.ts';
import type { PageRec } from '../../../packages/sdk-browser/src/page/selection/types.ts';
import { mesure, rapport } from '../../core/index.ts';
import {
  referenceCompteMateriauxEtTangentes,
  referenceIndexSourceBytes,
} from '../../oracles/browser/normal-cones.ts';
import { catalogueDePages } from './support/scenesLoading.ts';

const pages = catalogueDePages({ pages: 20000, materiaux: 60 });
const unePage = catalogueDePages({ pages: 1, materiaux: 1, seed: 17 });
// Every fifth page has no index bytes yet: the table leaves it out.
const partiels = catalogueDePages({ pages: 400, materiaux: 8, seed: 23 }).map((rec, i) =>
  i % 5 === 0 ? { ...rec, array: undefined } : rec,
);

const blocs = new Map<string, { hasTangent: boolean }>();
for (let i = 0; i < 4000; i++) blocs.set(`bloc/${i}`, { hasTangent: i % 3 === 0 });
const blocVide = new Map<string, { hasTangent: boolean }>();

const casPages = [
  { name: '20 000 pages, 60 materials', input: pages, size: 20000 },
  { name: 'pages without index bytes', input: partiels, size: 400 },
  { name: 'a single page', input: unePage, size: 1 },
  { name: 'no pages', input: [], size: 0 },
];

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

rapport('cones-normaux', [resOctets, resDiagnostic], 'F18 yields the exact same bytes and counts');
