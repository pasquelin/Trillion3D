// H2b : le décodeur de pages écrit en Rust et compilé en WebAssembly, contre le décodeur JavaScript
// de `geometryPage.ts`. Référence = le décodeur JS actuel, tel quel ; « optimisée » = le module
// wasm. La ligne n'est retenue que si les deux rendent exactement les mêmes tampons — mêmes
// `Uint32Array` d'indices, mêmes `Float32Array` d'attributs, `Object.is` valeur par valeur — et que
// le module est le plus rapide des deux.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodeGeometryPage } from '../geometryPage.ts';
import { decodeGeometryPageWasm, prepareSdkWasm } from '../geometryPageWasm.ts';
import { RACINE, compare, verifieEtDepose } from '../../sdk-core/bench/banc.mjs';
import { page, pageBrute, sommetsPlats } from './pagesH2b.mjs';

const MODULE = join(RACINE, 'packages', 'sdk-browser', 'pageCodec.wasm');
const FRAGMENTS = join(RACINE, '.mesure', 'calculs-h2b');

// Node ne suit pas une URL de fichier avec `fetch` : l'hôte fournit les octets, comme prévu par le
// chargeur. Sans module, la ligne mesurerait le décodeur JS contre lui-même : autant s'arrêter.
const codec = await prepareSdkWasm(readFileSync(MODULE));
if (!codec) throw new Error('H2B_WASM_ABSENT : lancer `npm run build:wasm`');

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

const lignes = [
  await compare({
    calcul: 'H2b1 décodage de page, wasm contre JS',
    fichier: 'packages/sdk-browser/geometryPageWasm.ts',
    cas: [
      { nom: 'page pleine : 65 535 sommets, tous les attributs', entree: [dense], taille: 65535 },
      { nom: '2 048 sommets, tous les attributs', entree: [moyenne], taille: 2048 },
      { nom: '2 048 sommets, positions seules', entree: [nue], taille: 2048 },
      { nom: '96 sommets', entree: [petite], taille: 96 },
      { nom: 'seize pages moyennes à la suite', entree: Array(16).fill(moyenne), taille: 16 },
    ],
    reference: tour(decodeGeometryPage),
    optimisee: tour(decodeGeometryPageWasm),
    options: { tours: 200, budgetMs: 8000, alterne: true },
  }),
  await compare({
    calcul: 'H2b2 refus de page, wasm contre JS',
    fichier: 'packages/sdk-browser/geometryPageWasm.ts',
    cas: [
      { nom: 'indice hors borne', entree: [horsBorne], taille: 3 },
      { nom: 'flottant NaN', entree: [nonFini], taille: 3 },
      { nom: 'flottant infini', entree: [infini], taille: 3 },
      { nom: 'page tronquée', entree: [tronquee], taille: tronquee.length },
      { nom: 'en-tête trop court', entree: [courte], taille: 16 },
      { nom: 'magie fausse', entree: [faussee], taille: faussee.length },
    ],
    reference: tour(decodeGeometryPage),
    optimisee: tour(decodeGeometryPageWasm),
    options: { tours: 200, budgetMs: 2000, alterne: true },
  }),
];

verifieEtDepose(
  'decodage-wasm',
  'H2b rend exactement les mêmes tampons et les mêmes refus que le décodeur JavaScript',
  lignes,
  FRAGMENTS,
);
