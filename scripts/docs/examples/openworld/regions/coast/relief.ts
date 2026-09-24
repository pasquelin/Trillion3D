/**
 * How the coast shapes the plan's relief and paints its ground. Everything reads the base
 * height alone: the shoreline is where the base crosses sea level, so the refinement follows
 * any coastline the plan draws, islands included.
 *
 * - Chalk cliffs: along some stretches of shore (a seeded, kilometre-scale mask) the land just
 *   above the waterline is lifted by 30–70 m, the height real chalk coasts reach; the lift
 *   rises over the first half metre of base height, a few tens of metres of ground, so the
 *   face is steep, and fades inland so the cliff top slopes back to the plan's land.
 * - Beaches: elsewhere, the first ten metres above the sea are lowered by up to 60 %, a
 *   flatter and wider strand a few metres high at the water, whatever step the plan's shore has.
 * - Dunes: behind the strand, a ripple of a few metres, the height of real coastal dunes.
 * - Terraces: in patches of the land above, the slope is stepped into flats and banks, the
 *   ground the coast's villages are built on.
 */
import { WORLD, type GroundLayer } from '../../plan/contract.ts';
import { valueNoise } from '../../props/index.ts';
import { GROUND } from './surfaces.ts';

const smoothstep = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** The kit's value noise as a field in [0, 1] over a lattice of `cell` metres. */
export const field = (seed: number, x: number, z: number, cell: number) =>
  0.5 + 0.5 * valueNoise(seed, [x / cell, 0, z / cell]);

/**
 * The seed of the refinement. `refine` receives no plan, so it cannot read a sub-seed; it
 * draws from the world's fixed seed instead (reported: the contract passes no seed to it).
 */
const RELIEF_SEED = WORLD.seed * 7919 + 17;

/** Scale of the cliff mask: stretches of cliff and beach a few kilometres long. */
const CLIFF_STRETCH = 2_600;

/** 0 on a beach, 1 on a chalk cliff stretch, smooth between. */
const cliffness = (x: number, z: number) =>
  smoothstep(0.5, 0.62, field(RELIEF_SEED, x, z, CLIFF_STRETCH));

/** The cliff's full height on a stretch: between 30 and 70 m. */
const cliffHeight = (x: number, z: number) =>
  30 + 40 * field(RELIEF_SEED + 1, x, z, CLIFF_STRETCH / 2);

/** Dune ripple, metres: ridges about 70 m apart, broken along their length. */
const dunes = (x: number, z: number) =>
  4 * field(RELIEF_SEED + 2, x, z, 70) * field(RELIEF_SEED + 3, x, z, 300);

/** Rise of one terrace, metres: a field terrace's wall, which a village street can climb. */
const TERRACE = 4;

/**
 * Terraced hillsides in kilometre-wide patches of the land above the dunes: each 4 m of rise
 * becomes a flat step (the first 70 % of it) and a short bank, flat ground for villages and
 * fields.
 */
function terrace(x: number, z: number, height: number): number {
  const patch =
    smoothstep(0.4, 0.55, field(RELIEF_SEED + 4, x, z, 1_500)) *
    smoothstep(15, 25, height) *
    (1 - smoothstep(250, 300, height));
  if (patch <= 0) return 0;
  const step = Math.floor(height / TERRACE),
    flat = TERRACE * (step + smoothstep(0.7, 1, height / TERRACE - step));
  return patch * (flat - height);
}

/** The coast's addition to the base relief at (x, z). */
export function refine(x: number, z: number, base: number): number {
  if (base <= 0 || base > 300) return 0;
  const cliff = cliffness(x, z),
    lift = cliff * cliffHeight(x, z) * smoothstep(0, 0.5, base) * (1 - smoothstep(30, 90, base)),
    strand = (1 - cliff) * -0.6 * base * (1 - smoothstep(6, 12, base)),
    dune = (1 - cliff) * dunes(x, z) * smoothstep(8, 11, base) * (1 - smoothstep(18, 26, base)),
    shaped = lift + strand + dune;
  return shaped + terrace(x, z, base + shaped);
}

/**
 * Ground paint, first match wins; slopes as angle / 90°. Wet sand on the flat strand, dry sand
 * and dunes up to sand's angle of repose (34°), turf and heath up to 40°, bare chalk beyond.
 */
export const GROUND_LAYERS: readonly GroundLayer[] = [
  { surface: GROUND.wetSand, maxHeight: 1, maxSlope: 0.1 },
  { surface: GROUND.sand, maxHeight: 5, maxSlope: 0.3 },
  { surface: GROUND.duneSand, maxHeight: 20, maxSlope: 34 / 90 },
  { surface: GROUND.headlandGrass, maxHeight: 150, maxSlope: 40 / 90 },
  { surface: GROUND.heath, maxSlope: 40 / 90 },
  { surface: GROUND.cliffChalk },
];
