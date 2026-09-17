// décodeur de pages Rust/WebAssembly contre JavaScript.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodeGeometryPage } from '../geometryPage.ts';
import { decodeGeometryPageWasm, prepareSdkWasm } from '../geometryPageWasm.ts';
import { RACINE, mesure, stress, rapport } from '../../sdk-core/bench/socle.mjs';
import { page, pageBrute, sommetsPlats } from './appui/pagesWasm.mjs';

const MODULE = join(RACINE, 'packages', 'sdk-browser', 'pageCodec.wasm');
const codec = await prepareSdkWasm(readFileSync(MODULE));
if (!codec) throw new Error('H2B_WASM_ABSENT : lancer `pnpm run build:wasm`');

const dense = await page(65535, true),
  moyenne = await page(2048, true),
  nue = await page(2048, false),
  petite = await page(96, true);

const horsBorne = await pageBrute(sommetsPlats(), [0, 1, 3], 3, 0),
  nonFini = await pageBrute(sommetsPlats(Number.NaN), [0, 1, 2], 3, 0),
  infini = await pageBrute(sommetsPlats(Number.POSITIVE_INFINITY), [0, 1, 2], 3, 0),
  tronquee = moyenne.subarray(0, moyenne.length - 1),
  courte = moyenne.subarray(0, 16),
  faussee = Uint8Array.from(moyenne);
faussee[0] ^= 1;

/** Un tour : toutes les pages du cas, décodées ; un refus devient sa cause, comparée elle aussi. */
const tour = (decode) => async (pages) => {
  const sortie = [];
  for (const octets of pages) {
    try {
      sortie.push(await decode(octets));
    } catch (erreur) {
      sortie.push({ refus: erreur.message });
    }
  }
  return sortie;
};

const resWasm = await mesure({
  nom: 'décodage de page, wasm contre JS',
  fichier: 'packages/sdk-browser/geometryPageWasm.ts',
  cas: [
    { nom: 'page pleine : 65 535 sommets, tous attributs', entree: [dense], taille: 65535 },
    { nom: '2 048 sommets, tous attributs', entree: [moyenne], taille: 2048 },
    { nom: '2 048 sommets, positions seules', entree: [nue], taille: 2048 },
    { nom: '96 sommets', entree: [petite], taille: 96 },
  ],
  calcul: tour(decodeGeometryPageWasm),
  attendu: tour(decodeGeometryPage),
  options: { tours: 40, budgetMs: 2000 },
});

const resRefus = await mesure({
  nom: 'refus de page, wasm contre JS',
  fichier: 'packages/sdk-browser/geometryPageWasm.ts',
  cas: [
    { nom: 'indice hors borne', entree: [horsBorne], taille: 3 },
    { nom: 'flottant NaN', entree: [nonFini], taille: 3 },
    { nom: 'flottant infini', entree: [infini], taille: 3 },
    { nom: 'page tronquée', entree: [tronquee], taille: tronquee.length },
    { nom: 'en-tête trop court', entree: [courte], taille: 16 },
    { nom: 'magie fausse', entree: [faussee], taille: faussee.length },
  ],
  calcul: tour(decodeGeometryPageWasm),
  attendu: tour(decodeGeometryPage),
  options: { tours: 40, budgetMs: 2000 },
});

await stress({
  nom: 'decodeGeometryPageWasm extremes',
  calcul: async (octets) => {
    try {
      await decodeGeometryPageWasm(octets);
    } catch {
      // Rejets attendus
    }
  },
  extremes: [
    { nom: 'tronquee', entree: moyenne.subarray(0, moyenne.length - 1) },
    { nom: 'courte', entree: moyenne.subarray(0, 16) },
  ],
});

rapport(
  'decodage-wasm',
  [resWasm, resRefus],
  'H2b rend exactement les mêmes tampons et les mêmes refus que le décodeur JavaScript',
);
