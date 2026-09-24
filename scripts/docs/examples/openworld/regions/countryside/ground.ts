/**
 * The countryside's own surfaces, its ground layers and its rolling hills. The hills are a
 * seeded value noise added to the global relief; the plan fades them by the biome weights, so the
 * region's borders stay seamless.
 */
import type { GroundLayer } from '../../plan/contract.ts';
import { ALBEDO, ground } from '../../plan/surfaces.ts';
import { card, fractalNoise, surface } from '../../props/index.ts';

/** Every surface the countryside adds to the shared palette, linear RGB. */
export const LAND = {
  // The grounds' brightness is Oke's albedo range for their cover (`plan/surfaces.ts`).
  meadow: ground('countryside/meadow', [0.1, 0.2, 0.04], ALBEDO.longToShortGrass),
  grass: ground('countryside/grass', [0.07, 0.14, 0.035], ALBEDO.longToShortGrass),
  heath: ground('countryside/heath', [0.16, 0.13, 0.06], ALBEDO.tundra),
  earth: ground('countryside/earth', [0.2, 0.13, 0.07], ALBEDO.soil),
  wheat: surface('countryside/wheat', [0.62, 0.45, 0.14], 0, 0.9),
  rapeseed: surface('countryside/rapeseed', [0.78, 0.62, 0.02], 0, 0.85),
  ploughed: surface('countryside/ploughed', [0.16, 0.09, 0.04], 0, 1),
  pasture: surface('countryside/pasture', [0.12, 0.26, 0.05], 0, 0.95),
  lavender: surface('countryside/lavender', [0.3, 0.16, 0.5], 0, 0.9),
  stone: surface('countryside/stone', [0.46, 0.42, 0.34], 0, 0.9),
  cobble: surface('countryside/cobble', [0.3, 0.28, 0.25], 0, 0.95),
  barnRed: surface('countryside/barn-red', [0.32, 0.05, 0.03], 0, 0.8),
  shutterGreen: surface('countryside/shutter-green', [0.06, 0.2, 0.1], 0, 0.6),
  shutterBlue: surface('countryside/shutter-blue', [0.08, 0.16, 0.32], 0, 0.6),
  tractor: surface('countryside/tractor-green', [0.05, 0.25, 0.04], 0.3, 0.45),
  hay: surface('countryside/hay', [0.55, 0.42, 0.16], 0, 1),
  thatch: surface('countryside/thatch', [0.36, 0.27, 0.12], 0, 1),
  hedge: card('countryside-hedge', [0.035, 0.1, 0.02], 0.85),
  appleLeaves: card('countryside-apple-leaves', [0.07, 0.17, 0.035]),
  fruit: surface('countryside/fruit', [0.55, 0.05, 0.02], 0, 0.4),
  cloth: surface('countryside/sail-cloth', [0.78, 0.74, 0.64], 0, 0.9),
  porchLamp: surface('countryside/porch-lamp', [1, 0.78, 0.5], 0, 0.5, {
    emissive: [1, 0.78, 0.5],
    emissiveStrength: 10,
  }),
};

/**
 * First layer that fits wins (the terrain's rule). Lush meadow on the gentle lowland, darker
 * grass as it steepens, heath on the high ground, bare earth on the steepest soil.
 */
export const GROUND: readonly GroundLayer[] = [
  { surface: LAND.meadow, maxSlope: 0.08, maxHeight: 450 },
  { surface: LAND.grass, maxSlope: 0.2, maxHeight: 450 },
  { surface: LAND.heath, minHeight: 450, maxSlope: 0.28 },
  { surface: LAND.earth, maxSlope: 0.36 },
];

/** Kit fractal noise over the ground plane, about ±1. */
export const fbm = (seed: number, x: number, z: number, octaves: number) =>
  fractalNoise(seed, [x, 0.5, z], octaves);

/**
 * The refinement's fixed seed: the terrain is composed before any region seed is read
 * (`refine` receives no plan), so the hills take theirs from the region's name.
 */
const HILLS = [...'countryside'].reduce(
  (h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619),
  2166136261,
);

/** Rolling hills: a few tens of metres over kilometres, a few metres over hundreds, on land. */
export function refineHills(x: number, z: number, base: number): number {
  const land = Math.min(1, Math.max(0, base / 40));
  return (
    land * (28 * fbm(HILLS, x / 2_600, z / 2_600, 3) + 4 * fbm(HILLS + 7, x / 420, z / 420, 2))
  );
}
