/**
 * The coast's own palette, named `coast/…` so no other region's material collides with it.
 * Linear-space base colours; the shared palette (`SURFACES`) covers wood, steel, glass, lamps.
 */
import { ALBEDO, ground } from '../../plan/surfaces.ts';
import { card, glow, surface } from '../../props/index.ts';

export const COAST = {
  chalk: surface('coast/chalk', [0.78, 0.76, 0.7], 0, 0.92),
  chalkShadow: surface('coast/chalk-grey', [0.55, 0.54, 0.5], 0, 0.95),
  flint: surface('coast/flint-band', [0.16, 0.15, 0.14], 0, 0.8),
  grassCap: surface('coast/turf', [0.09, 0.2, 0.05], 0, 0.9),
  marramGrass: card('coast/marram-grass', [0.34, 0.36, 0.14], 0.85),
  towerWhite: surface('coast/tower-white', [0.86, 0.86, 0.83], 0, 0.6),
  towerRed: surface('coast/tower-red', [0.5, 0.03, 0.02], 0, 0.55),
  lanternGlass: surface('coast/lantern-glass', [0.3, 0.35, 0.3], 0.2, 0.05),
  lanternLamp: glow('coast/lantern-lamp', [1, 0.9, 0.62], 40),
  granite: surface('coast/granite', [0.3, 0.29, 0.27], 0, 0.9),
  quayStone: surface('coast/quay-stone', [0.4, 0.37, 0.32], 0, 0.9),
  weatheredWood: surface('coast/weathered-wood', [0.3, 0.26, 0.2], 0, 0.9),
  deckWood: surface('coast/deck-wood', [0.36, 0.25, 0.15], 0, 0.8),
  whitewash: surface('coast/whitewash', [0.84, 0.82, 0.76], 0, 0.9),
  ochre: surface('coast/ochre-render', [0.62, 0.42, 0.18], 0, 0.9),
  seaBlue: surface('coast/sea-blue-paint', [0.05, 0.2, 0.42], 0, 0.6),
  shutterGreen: surface('coast/shutter-green', [0.06, 0.24, 0.14], 0, 0.6),
  terracotta: surface('coast/terracotta', [0.46, 0.14, 0.05], 0, 0.75),
  canvasRed: card('coast/canvas-red', [0.62, 0.05, 0.04], 0.9),
  canvasWhite: card('coast/canvas-white', [0.88, 0.86, 0.8], 0.9),
  canvasBlue: card('coast/canvas-blue', [0.04, 0.18, 0.55], 0.9),
  canvasYellow: card('coast/canvas-yellow', [0.85, 0.6, 0.05], 0.9),
  lifeRed: surface('coast/lifeguard-red', [0.7, 0.04, 0.03], 0, 0.5),
  buoyOrange: surface('coast/buoy-orange', [0.9, 0.25, 0.02], 0, 0.5),
  galvanised: surface('coast/galvanised', [0.55, 0.57, 0.58], 1, 0.45),
  hullBlue: surface('coast/hull-blue', [0.03, 0.1, 0.3], 0.1, 0.5),
  hullGreen: surface('coast/hull-green', [0.04, 0.2, 0.1], 0.1, 0.5),
} as const;

/**
 * Ground paints, by altitude and slope; dry sand, turf and heath at Oke's albedo range for
 * their cover (`plan/surfaces.ts`: dry sand is a desert's, heath a tundra's).
 */
export const GROUND = {
  wetSand: surface('coast/wet-sand', [0.42, 0.36, 0.25], 0, 0.5),
  sand: ground('coast/sand', [0.76, 0.66, 0.46], ALBEDO.desert),
  duneSand: ground('coast/dune-sand', [0.7, 0.62, 0.42], ALBEDO.desert),
  cliffChalk: surface('coast/cliff-chalk', [0.74, 0.72, 0.66], 0, 0.92),
  headlandGrass: ground('coast/headland-grass', [0.14, 0.24, 0.07], ALBEDO.longToShortGrass, 0.9),
  heath: ground('coast/heath', [0.2, 0.2, 0.09], ALBEDO.tundra),
} as const;
