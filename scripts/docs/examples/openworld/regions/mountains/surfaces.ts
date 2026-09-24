/**
 * The mountains' own surfaces (named `mountains/…`, linear RGB) and the ground layers the
 * terrain paints: snow above the snow line, alpine turf between the tree line and the snow,
 * hay meadows on the gentle ground below the tree line, the dark floor of the forest on the
 * slopes it holds, and grey granite on every face too steep for soil.
 */
import type { GroundLayer } from '../../plan/contract.ts';
import { REPOSE } from '../../plan/rivers.ts';
import { ALBEDO, ground, SURFACE } from '../../plan/surfaces.ts';
import { card, glow, surface } from '../../props/index.ts';
import { SNOW_LINE, TREE_LINE } from './terrain.ts';

/** A slope threshold in the ground layers' unit (the angle over 90°) from degrees. */
export const steep = (degrees: number) => degrees / 90;

const s = (name: string, rgb: readonly [number, number, number], metal = 0, rough = 0.85) =>
  surface(`mountains/${name}`, rgb, metal, rough);

export const MOUNTAIN_SURFACES = {
  snow: s('snow', [0.86, 0.88, 0.92], 0, 0.55),
  granite: s('granite', [0.32, 0.31, 0.3], 0, 0.9),
  darkRock: s('dark-rock', [0.14, 0.13, 0.13], 0, 0.92),
  meadow: s('alpine-meadow', [0.12, 0.2, 0.05], 0, 0.9),
  larch: card('mountains-larch', [0.42, 0.26, 0.03]),
  frost: card('mountains-frost', [0.36, 0.42, 0.42], 0.7),
  logWood: s('log-wood', [0.2, 0.1, 0.045], 0, 0.8),
  darkWood: s('dark-wood', [0.1, 0.05, 0.025], 0, 0.8),
  shingle: s('shingle', [0.16, 0.13, 0.11], 0, 0.9),
  stoneWall: s('stone-wall', [0.4, 0.38, 0.35], 0, 0.95),
  whitewash: s('whitewash', [0.78, 0.76, 0.7], 0, 0.9),
  shutterGreen: s('shutter-green', [0.05, 0.16, 0.08], 0, 0.6),
  shutterRed: s('shutter-red', [0.35, 0.04, 0.03], 0, 0.6),
  geranium: s('geranium', [0.6, 0.02, 0.03], 0, 0.7),
  verdigris: s('verdigris', [0.12, 0.35, 0.28], 0.6, 0.5),
  gilt: s('gilt', [0.8, 0.55, 0.15], 1, 0.3),
  concrete: s('concrete', [0.46, 0.45, 0.42], 0, 0.9),
  domeWhite: s('dome-white', [0.85, 0.86, 0.86], 0.4, 0.3),
  cabinRed: s('cabin-red', [0.55, 0.02, 0.02], 0.3, 0.4),
  poleOrange: s('pole-orange', [0.8, 0.22, 0.01], 0, 0.6),
  water: s('lake-water', [0.01, 0.045, 0.06], 0, 0.04),
  whiteWater: s('white-water', [0.82, 0.86, 0.9], 0, 0.3),
  tunnelDark: s('tunnel-dark', [0.01, 0.01, 0.01], 0, 1),
  lantern: glow('mountains/lantern', [1, 0.7, 0.4], 10),
  sodium: glow('mountains/tunnel-lamp', [1, 0.55, 0.15], 10),
  beacon: glow('mountains/beacon-red', [1, 0.05, 0.02], 8),
} as const;

/** Soil's angle of repose, as a slope in the layers' unit: steeper ground is bare rock. */
const SOIL = Math.atan(REPOSE) / (Math.PI / 2);

/**
 * The ground's colours, their brightness Oke's albedo range for their cover (`plan/surfaces.ts`):
 * alpine turf is tundra, a mown meadow is short grass, the forest floor is as dark as the
 * conifer stand over it; granite is the shared rock.
 */
const GROUND = {
  turf: ground('mountains/alpine-turf', [0.15, 0.21, 0.07], ALBEDO.tundra),
  meadow: ground('mountains/hay-meadow', [0.1, 0.2, 0.04], ALBEDO.longToShortGrass),
  floor: ground('mountains/forest-floor', [0.08, 0.09, 0.04], ALBEDO.coniferous),
};

/**
 * The layers, most specific first; a point takes the first layer whose limits it meets. Snow
 * holds up to ~45°, soil up to its angle of repose; hay meadows lie on the valley floors and
 * gentle benches (up to 18°), the forest on the slopes between; the last layer, bare granite,
 * takes what no other holds (the terrain paints the same rock past its slope).
 */
export const MOUNTAIN_GROUND: readonly GroundLayer[] = [
  { surface: SURFACE.snow, minHeight: SNOW_LINE, maxSlope: steep(45) },
  { surface: GROUND.turf, minHeight: TREE_LINE, maxSlope: SOIL },
  { surface: GROUND.meadow, maxHeight: TREE_LINE, maxSlope: steep(18) },
  { surface: GROUND.floor, maxHeight: TREE_LINE, maxSlope: SOIL },
  { surface: SURFACE.rock },
];
