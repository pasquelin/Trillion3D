// H2b : décodeur de pages Rust/WebAssembly contre JavaScript.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodeGeometryPage } from '../geometryPage.ts';
import { decodeGeometryPageWasm, prepareSdkWasm } from '../geometryPageWasm.ts';
import { RACINE, mesure, stress, rapport } from '../../sdk-core/bench/mesure.mjs';
import { page } from './pagesWasm.mjs';

const MODULE = join(RACINE, 'packages', 'sdk-browser', 'pageCodec.wasm');
const codec = await prepareSdkWasm(readFileSync(MODULE));
if (!codec) throw new Error('H2B_WASM_ABSENT : lancer `npm run build:wasm`');

const dense = await page(65535, true),
  moyenne = await page(2048, true),
  nue = await page(2048, false),
  petite = await page(96, true);

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
  nom: 'H2b1 décodage de page, wasm contre JS',
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

rapport('decodage-wasm', [resWasm], 'H2b rend exactement les mêmes tampons décodés');
