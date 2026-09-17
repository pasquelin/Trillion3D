// coins monde de la coupe Hi-Z (évaluation avec/sans cache).
import { HIZ_BOUNDS_VALUES, createBoxCorners, projectBoxesFlat } from '../hiz.ts';
import { mesure, stress, rapport } from '../../sdk-core/bench/socle.mjs';
import { boites, camera } from './appui/scenes.mjs';
import { cameraMoteur } from '../cameraFixture.ts';

const LARGEUR = 640,
  HAUTEUR = 360;
const cam = camera(6, 0.1, LARGEUR / HAUTEUR),
  viewport = [LARGEUR, HAUTEUR];

const grande = boites({ count: 20000 });
const hostiles = grande.slice(0, 9).map((page, i) => ({
  ...page,
  min: [[-0, NaN, Infinity][i % 3], -0, 5e-324],
  max: [[0, NaN, -Infinity][i % 3], 0, 1.7976931348623157e308],
}));

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
  cas(hostiles, 'bornes hostiles'),
];

const resCoins = await mesure({
  nom: 'coins monde de la coupe Hi-Z',
  fichier: 'packages/sdk-browser/hizUnoccluded.ts, packages/sdk-browser/hizSplit.ts',
  cas: jeux,
  calcul: (e) => {
    projectBoxesFlat(e.pages, e.pages.length, cameraMoteur(cam), viewport, e.avecCache);
    return e.avecCache;
  },
  attendu: (e) => {
    projectBoxesFlat(e.pages, e.pages.length, cameraMoteur(cam), viewport, e.sansCache);
    return e.sansCache;
  },
  options: { tours: 40, budgetMs: 1500 },
});

await stress({
  nom: 'projectBoxesFlat extremes',
  calcul: (b) =>
    projectBoxesFlat(b, b.length, cameraMoteur(cam), viewport, new Float64Array(HIZ_BOUNDS_VALUES)),
  extremes: [{ nom: 'vide', entree: [] }],
});

rapport('coins-hiz', [resCoins], 'G2 les deux projections calculent les mêmes rectangles');
