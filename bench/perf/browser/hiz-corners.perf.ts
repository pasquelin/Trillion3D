// world-space corners of the Hi-Z cut (evaluation with/without cache).
import {
  HIZ_BOUNDS_VALUES,
  createBoxCorners,
  projectBoxesFlat,
} from '../../../packages/sdk-browser/src/hiz/hiz.ts';
import { mesure, stress, rapport } from '../../core/index.ts';
import { boites, camera } from './support/scenes.ts';
import { cameraMoteur } from '../../../packages/sdk-browser/src/camera/camera.fixture.ts';
import type { HizPage } from '../../../packages/sdk-browser/src/hiz/types.ts';

const LARGEUR = 640,
  HAUTEUR = 360;
const cam = camera(6, 0.1, LARGEUR / HAUTEUR),
  viewport: [number, number] = [LARGEUR, HAUTEUR];

const grande = boites({ count: 20000 });
const hostiles = grande.slice(0, 9).map((page, i) => ({
  ...page,
  min: [[-0, NaN, Infinity][i % 3], -0, 5e-324],
  max: [[0, NaN, -Infinity][i % 3], 0, 1.7976931348623157e308],
}));

function cas(pages: HizPage[], name: string) {
  const pageIndex = new Int32Array(pages.length).map((_, i) => i);
  return {
    name,
    size: pages.length,
    input: {
      pages,
      sansCache: new Float64Array(Math.max(1, pages.length) * HIZ_BOUNDS_VALUES),
      avecCache: new Float64Array(Math.max(1, pages.length) * HIZ_BOUNDS_VALUES),
      monde: { corners: createBoxCorners(pages.length), pageIndex, epoch: 0 },
    },
  };
}
const jeux = [
  cas(grande, '20 000 boxes including degenerates'),
  cas(grande.slice(0, 1), 'one box'),
  cas([], 'no boxes'),
  cas(hostiles, 'hostile bounds'),
];

const resCoins = await mesure({
  name: 'world-space corners of the Hi-Z cut',
  fichier: ['packages/sdk-browser/src/hiz/unoccluded.ts', 'packages/sdk-browser/src/hiz/split.ts'],
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
  name: 'projectBoxesFlat extremes',
  calcul: (b) =>
    projectBoxesFlat(b, b.length, cameraMoteur(cam), viewport, new Float64Array(HIZ_BOUNDS_VALUES)),
  extremes: [{ name: 'empty', input: [] }],
});

rapport('coins-hiz', [resCoins], 'G2 both projections compute the same rectangles');
