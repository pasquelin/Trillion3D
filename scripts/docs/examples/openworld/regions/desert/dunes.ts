/**
 * Wind-shaped dunes, heights in metres above the plain. One prevailing wind shapes them all:
 * - barchans, where sand is scarce: crescents with a gentle windward (stoss) slope, a steep
 *   slip face at the angle of repose, and horns reaching downwind;
 * - linear (seif) dunes, where sand is plentiful: long sharp-crested ridges along the wind.
 * Every proportion is a published morphometric ratio, named where it is used.
 */
import { WORLD } from '../../plan/contract.ts';
import { FIELD_SEED, fbm, hash01, smoothstep, valueNoise } from './field.ts';

/**
 * Where the wind blows toward, radians from +X toward +Z: the trade wind of a subtropical
 * desert, from the north-east toward the south-west (+Z is south). The page's wind should
 * share it so blowing sand leaves the crests the way the dunes lean.
 */
export const WIND_HEADING = (3 * Math.PI) / 4;

const DEG = Math.PI / 180;
/** Angle of repose of dry quartz sand: the slip face stands at it. */
const REPOSE = Math.tan(34 * DEG);
/** Windward slope of barchans in field surveys, 10–12°. */
const STOSS = Math.tan(11 * DEG);
/** Barchan width over height, about 10 (Hesp & Hastings 1998): half-width 5 H. */
const HALF_WIDTH = 5;
/** Barchan heights, metres (field range 3–30 m, the common middle). */
const BARCHAN = { min: 6, max: 18 };
/** Seif dunes stand 20–100 m; flanks at 20° (windward side) and 28° (lee). */
const SEIF = { min: 25, max: 60, flank: Math.tan(20 * DEG), lee: Math.tan(28 * DEG) };

const cosW = Math.cos(WIND_HEADING),
  sinW = Math.sin(WIND_HEADING);

/** (x, z) in the wind's frame: `u` downwind, `v` across. */
const windFrame = (x: number, z: number) => ({
  u: x * cosW + z * sinW,
  v: -x * sinW + z * cosW,
});

/** One barchan of height `h` at local (a downwind, b across) from its crest's centre. */
function barchan(a: number, b: number, h: number): number {
  const w = HALF_WIDTH * h,
    across = 1 - (b / w) ** 2;
  if (across <= 0) return 0;
  const hb = h * Math.sqrt(across),
    // Horns lead downwind: the crest line bends by 0.6 W at the tips.
    ar = a - (0.6 / w) * b * b;
  return ar < 0 ? Math.max(0, hb + ar * STOSS) : Math.max(0, hb - ar * REPOSE);
}

/** A cell holds at most one barchan; its size keeps the largest dune inside its neighbours. */
const CELL_U = (2 * BARCHAN.max) / STOSS,
  CELL_V = 2.2 * HALF_WIDTH * BARCHAN.max;

function barchans(u: number, v: number): number {
  const iu = Math.floor(u / CELL_U),
    iv = Math.floor(v / CELL_V);
  let h = 0;
  for (let di = -1; di <= 1; di++)
    for (let dj = -1; dj <= 1; dj++) {
      const ci = iu + di,
        cj = iv + dj;
      if (hash01(FIELD_SEED + 11, ci, cj) > 0.55) continue;
      const size = BARCHAN.min + (BARCHAN.max - BARCHAN.min) * hash01(FIELD_SEED + 12, ci, cj),
        cu = (ci + 0.3 + 0.4 * hash01(FIELD_SEED + 13, ci, cj)) * CELL_U,
        cv = (cj + 0.3 + 0.4 * hash01(FIELD_SEED + 14, ci, cj)) * CELL_V;
      h = Math.max(h, barchan(u - cu, v - cv, size));
    }
  return h;
}

/** Crest spacing: interdune corridors about twice a dune's own width. */
const SPACING = 3 * SEIF.max * (1 / SEIF.flank + 1 / SEIF.lee);

function seifs(u: number, v: number): number {
  // Crests wander across the wind over kilometres (sinuous seifs), and break along it.
  const w = v + 0.12 * SPACING * valueNoise(FIELD_SEED + 21, u / 2400, v / SPACING),
    row = Math.floor(w / SPACING),
    d = w - (row + 0.5) * SPACING,
    along = smoothstep(-0.35, 0.2, valueNoise(FIELD_SEED + 22 + row, u / 3000, row)),
    h = (SEIF.min + (SEIF.max - SEIF.min) * hash01(FIELD_SEED + 23, row)) * along;
  return Math.max(0, h - Math.abs(d) * (d < 0 ? SEIF.flank : SEIF.lee));
}

/** Sand supply in [-1, 1]: ergs (sand seas) where high, gravel plains (regs) where low. */
/** Sand supply over the erg; its patches span a fifth of the world, so any desert band holds some. */
const SUPPLY_SCALE = WORLD.size / 5;
export const sandSupply = (x: number, z: number) =>
  fbm(FIELD_SEED + 31, x / SUPPLY_SCALE, z / SUPPLY_SCALE, 3);

/** Dune height at (x, z): barchans on the erg's fringe, seifs in its heart, none on the reg. */
export function duneHeight(x: number, z: number): number {
  const s = sandSupply(x, z);
  if (s < -0.1) return 0;
  const { u, v } = windFrame(x, z),
    fringe = smoothstep(-0.1, 0.1, s) * (1 - smoothstep(0.3, 0.45, s)),
    heart = smoothstep(0.3, 0.45, s);
  return Math.max(fringe > 0 ? fringe * barchans(u, v) : 0, heart > 0 ? heart * seifs(u, v) : 0);
}
