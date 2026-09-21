// Rust/WebAssembly page decoder against JavaScript.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodeGeometryPage } from '../geometryPage.ts';
import type { DecodedGeometryPage } from '../geometryPage.ts';
import { decodeGeometryPageWasm, prepareSdkWasm } from '../geometryPageWasm.ts';
import { RACINE, mesure, stress, rapport } from '../../sdk-core/bench/socle.ts';
import { page, pageForgee } from './appui/pagesWasm.ts';

const MODULE = join(RACINE, 'packages', 'sdk-browser', 'pageCodec.wasm');
const codec = await prepareSdkWasm(readFileSync(MODULE));
if (!codec) throw new Error('H2B_WASM_ABSENT: run `pnpm run build:wasm`');

const dense = page(65535, true),
  moyenne = page(2048, true),
  nue = page(2048, false),
  petite = page(96, true);

const horsBorne = pageForgee([0, 1, 3]),
  tronquee = moyenne.subarray(0, moyenne.length - 1),
  courte = moyenne.subarray(0, 16),
  faussee = Uint8Array.from(moyenne),
  tropLarge = Uint8Array.from(moyenne);
faussee[0] ^= 1;
// A position width past the format's 24 bits: refused by the header, before any stream.
tropLarge[20] = 25;

/** One lap: every page in the case, decoded; a rejection becomes its cause, compared as well. */
const tour =
  (decode: (data: Uint8Array) => Promise<DecodedGeometryPage> | DecodedGeometryPage) =>
  async (pages: Uint8Array[]) => {
    const output: (DecodedGeometryPage | { refus: string })[] = [];
    for (const octets of pages) {
      try {
        output.push(await decode(octets));
      } catch (erreur) {
        output.push({ refus: erreur instanceof Error ? erreur.message : String(erreur) });
      }
    }
    return output;
  };

const resWasm = await mesure({
  name: 'page decode, wasm against JS',
  fichier: 'packages/sdk-browser/geometryPageWasm.ts',
  cas: [
    { name: 'full page: 65 535 vertices, all attributes', input: [dense], size: 65535 },
    { name: '2 048 vertices, all attributes', input: [moyenne], size: 2048 },
    { name: '2 048 vertices, positions only', input: [nue], size: 2048 },
    { name: '96 vertices', input: [petite], size: 96 },
  ],
  calcul: tour(decodeGeometryPageWasm),
  attendu: tour(decodeGeometryPage),
  options: { tours: 40, budgetMs: 2000 },
});

const resRefus = await mesure({
  name: 'page rejection, wasm against JS',
  fichier: 'packages/sdk-browser/geometryPageWasm.ts',
  cas: [
    { name: 'index out of bounds', input: [horsBorne], size: 3 },
    { name: 'field wider than the format', input: [tropLarge], size: tropLarge.length },
    { name: 'truncated page', input: [tronquee], size: tronquee.length },
    { name: 'header too short', input: [courte], size: 16 },
    { name: 'wrong magic', input: [faussee], size: faussee.length },
  ],
  calcul: tour(decodeGeometryPageWasm),
  attendu: tour(decodeGeometryPage),
  options: { tours: 40, budgetMs: 2000 },
});

await stress({
  name: 'decodeGeometryPageWasm extremes',
  calcul: async (octets) => {
    try {
      await decodeGeometryPageWasm(octets);
    } catch {
      // Expected rejections
    }
  },
  extremes: [
    { name: 'tronquee', input: moyenne.subarray(0, moyenne.length - 1) },
    { name: 'courte', input: moyenne.subarray(0, 16) },
  ],
});

rapport(
  'decodage-wasm',
  [resWasm, resRefus],
  'H2b yields the exact same buffers and rejections as the JavaScript decoder',
);
