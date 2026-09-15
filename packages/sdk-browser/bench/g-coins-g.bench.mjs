// G2 : le cache de coins d'époque proposé pour le chemin CPU de secours (`hizUnoccluded.ts`,
// `hizSplit.ts`), qui passent tous deux par `projectBoxesFlat`. Le cache existe déjà pour le chemin
// GPU (`createBoxCorners`) ; la question est seulement de le brancher sur le chemin CPU.
//
// Mesure : la même projection, avec et sans le cache, sur les mêmes pages. Les rectangles sont
// identiques au bit près — le cache garde exactement les doubles que le chemin d'un seul coup
// calcule — mais la relecture de 24 doubles par page dans un tampon de plusieurs mégaoctets coûte
// au moins autant que la retransformation de huit coins depuis un tampon d'appoint resté en cache.
// L'indice de page est ici donné gratuitement, sans aucune recherche : c'est le plafond du gain, et
// il est négatif. Le point est donc neutre et rien n'est branché dans le moteur.
import { HIZ_BOUNDS_VALUES, createBoxCorners, projectBoxesFlat } from '../hiz.ts';
import { compare } from '../../sdk-core/bench/banc.mjs';
import { verifieEtDeposeG } from '../../sdk-core/bench/bancG.mjs';
import { boites, camera } from './scenes.mjs';

const LARGEUR = 640,
  HAUTEUR = 360;
const cam = camera(6, 0.1, LARGEUR / HAUTEUR),
  viewport = [LARGEUR, HAUTEUR];

const grande = boites({ count: 20000 });
/** Une page dont les bornes portent zéro signé, NaN, infinis et dénormal. */
const hostiles = grande.slice(0, 9).map((page, i) => ({
  ...page,
  min: [[-0, NaN, Infinity][i % 3], -0, 5e-324],
  max: [[0, NaN, -Infinity][i % 3], 0, 1.7976931348623157e308],
}));

/** Un cas : les pages, leur tampon de rectangles, et le cache de coins qui les suit. */
function cas(pages, nom) {
  const pageIndex = new Int32Array(pages.length).map((_, i) => i);
  return {
    nom,
    taille: pages.length,
    entree: {
      pages,
      sansCache: new Float64Array(Math.max(1, pages.length) * HIZ_BOUNDS_VALUES),
      avecCache: new Float64Array(Math.max(1, pages.length) * HIZ_BOUNDS_VALUES),
      monde: { corners: createBoxCorners(pages.length), pageIndex, epoch: 0 },
    },
  };
}
const jeux = [
  cas(grande, '20 000 boîtes dont dégénérées'),
  cas(grande.slice(0, 1), 'une boîte'),
  cas([], 'aucune boîte'),
  cas(hostiles, 'bornes hostiles : zéro signé, NaN, infinis, dénormal'),
  cas(grande.filter((_, i) => i % 311 === 0).slice(0, 64), 'que des coupes du plan proche'),
];

const lignes = [
  await compare({
    calcul: 'G2 coins monde de la coupe Hi-Z',
    fichier: 'packages/sdk-browser/hizUnoccluded.ts, hizSplit.ts',
    cas: jeux,
    reference: (e) => {
      projectBoxesFlat(e.pages, e.pages.length, cam, viewport, e.sansCache);
      return e.sansCache;
    },
    optimisee: (e) => {
      // Une image neuve à chaque tour : le cache paie sa première projection, comme en vrai.
      e.monde.epoch = (e.monde.epoch + 1) | 0 || 1;
      projectBoxesFlat(e.pages, e.pages.length, cam, viewport, e.avecCache, undefined, e.monde);
      return e.avecCache;
    },
    options: { tours: 200, budgetMs: 4000, alterne: true },
  }),
];

verifieEtDeposeG(
  'g-coins',
  'G2 rend les mêmes rectangles écran, au bit près, avec et sans le cache de coins',
  lignes,
);
