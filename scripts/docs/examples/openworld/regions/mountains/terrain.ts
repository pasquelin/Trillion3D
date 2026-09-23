/**
 * The mountains' relief on top of the plan's low-frequency range: sharp ridges (ridged noise,
 * domain-warped so crests bend), gullies cut into the flanks, and cirques — bowls with a flat
 * floor and a steep headwall, where the alpine lake settles. The refinement rises with the base
 * altitude, so the foothills stay gentle and the border with the lowlands stays seamless.
 *
 * `refine` sees no plan, only (x, z, base): its noise draws from the world seed the plan itself
 * derives from, so the relief is the same whichever module asks for it. The plan finds its
 * alpine lake in the deepest basin it sees, and a cirque floor is the kind of basin it finds.
 */
import { WORLD } from '../../plan/contract.ts';
import { hash01 } from '../../props/index.ts';

/** Where trees stop growing (alpine climate, 46° N), and the plan's snowline, metres. */
export const TREE_LINE = 2_000;
export const SNOW_LINE = WORLD.peak * 0.75;

/** Crest spacing of the ridges, metres: a range's main valleys are ~10 km apart. */
const RIDGE_SCALE = 10_000;
/** Relief the ridges add at full height: half of the highest peak. */
const RELIEF = WORLD.peak * 0.5;
/** Gully spacing and depth: side valleys cut into a flank, a few hundred metres apart. */
const GULLY_SCALE = 900;
const GULLY_DEPTH = 70;
/** Cirque lattice: one candidate bowl per 3 km cell, 650 m across its rim, 180 m deep. */
const CIRQUE_CELL = 3_000;
const CIRQUE_RADIUS = 650;
const CIRQUE_DEPTH = 180;

const NOISE_SEED = Math.floor(hash01(WORLD.seed, 0x6d6f756e) * 2 ** 31);

/** A seeded stream of numbers in [0, 1): the n-th draw depends only on the seed and n. */
export function draws(seed: number) {
  let n = 0;
  return () => hash01(seed, n++);
}

const smoothstep = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** 64 unit gradients around the circle; a lattice corner picks one by its hash. */
const GRADIENTS = Float64Array.from({ length: 128 }, (_, k) =>
  k % 2 ? Math.sin(((k >> 1) / 64) * Math.PI * 2) : Math.cos(((k >> 1) / 64) * Math.PI * 2),
);

/** The dot of corner (i, j)'s gradient with the offset (dx, dz) from it. */
function corner(seed: number, i: number, j: number, dx: number, dz: number) {
  const g = Math.floor(hash01(seed, i, j) * 64) * 2;
  return GRADIENTS[g] * dx + GRADIENTS[g + 1] * dz;
}

/** 2D gradient noise in about [-0.7, 0.7], seeded, stateless. */
export function perlin(seed: number, x: number, z: number): number {
  const i = Math.floor(x),
    j = Math.floor(z),
    fx = x - i,
    fz = z - j,
    u = fx * fx * fx * (fx * (fx * 6 - 15) + 10),
    v = fz * fz * fz * (fz * (fz * 6 - 15) + 10),
    a = corner(seed, i, j, fx, fz),
    b = corner(seed, i + 1, j, fx - 1, fz),
    c = corner(seed, i, j + 1, fx, fz - 1),
    d = corner(seed, i + 1, j + 1, fx - 1, fz - 1),
    bottom = a + (b - a) * u;
  return bottom + (c + (d - c) * u - bottom) * v;
}

/**
 * Ridged multifractal in [0, 1]: sharp crests where the noise crosses zero, each octave
 * weighted by the one before so detail gathers on the crests, not in the valleys.
 */
function ridged(seed: number, x: number, z: number, octaves: number): number {
  let sum = 0,
    norm = 0,
    amplitude = 1,
    weight = 1,
    frequency = 1;
  for (let o = 0; o < octaves; o++) {
    const signal =
      (1 - Math.min(1, Math.abs(perlin(seed + o, x * frequency, z * frequency)) * 1.6)) ** 2;
    sum += signal * amplitude * weight;
    norm += amplitude;
    weight = Math.min(1, signal * 1.8);
    amplitude *= 0.5;
    frequency *= 2.03;
  }
  return sum / norm;
}

/** A cirque's centre in lattice cell (i, j). */
function cirqueCentre(i: number, j: number): readonly [number, number] {
  return [
    (i + 0.25 + 0.5 * hash01(NOISE_SEED + 11, i, j)) * CIRQUE_CELL,
    (j + 0.25 + 0.5 * hash01(NOISE_SEED + 12, i, j)) * CIRQUE_CELL,
  ];
}

/** The cirque bowl weight at (x, z): 1 on the floor, 0 past the rim; and that bowl's centre. */
function cirque(x: number, z: number): { bowl: number; centre: readonly [number, number] } {
  const ci = Math.floor(x / CIRQUE_CELL),
    cj = Math.floor(z / CIRQUE_CELL);
  let best = { bowl: 0, centre: [x, z] as readonly [number, number] };
  for (let i = ci - 1; i <= ci + 1; i++)
    for (let j = cj - 1; j <= cj + 1; j++) {
      const centre = cirqueCentre(i, j),
        r = Math.hypot(x - centre[0], z - centre[1]) / CIRQUE_RADIUS,
        bowl = 1 - smoothstep(0.5, 1, r);
      if (bowl > best.bowl) best = { bowl, centre };
    }
  return best;
}

/** The ridge relief at (x, z), metres above the ridge floor, before the altitude lift. */
function ridgeRelief(x: number, z: number): number {
  const wx = x + 700 * perlin(NOISE_SEED + 20, x / 4_000, z / 4_000),
    wz = z + 700 * perlin(NOISE_SEED + 21, x / 4_000, z / 4_000);
  return (ridged(NOISE_SEED, wx / RIDGE_SCALE, wz / RIDGE_SCALE, 6) ** 1.5 * 1.5 - 0.2) * RELIEF;
}

/** The offset added to the plan's `base` height at (x, z), metres. */
export function refineMountains(x: number, z: number, base: number): number {
  const lift = smoothstep(150, 1_400, base);
  if (lift <= 0) return 0;
  const { bowl, centre } = cirque(x, z);
  // A cirque floor keeps the relief of its centre: flat, so a lake can settle in it.
  const relief = ridgeRelief(x, z) * (1 - bowl) + ridgeRelief(centre[0], centre[1]) * bowl,
    line = 1 - Math.min(1, Math.abs(perlin(NOISE_SEED + 30, x / GULLY_SCALE, z / GULLY_SCALE)) * 3),
    gully = line ** 3 * GULLY_DEPTH * smoothstep(0, RELIEF * 0.4, relief) * (1 - bowl);
  let height = base + lift * (relief - gully - CIRQUE_DEPTH * bowl);
  // Soft ceiling: nothing climbs past the world's highest peak.
  const knee = WORLD.peak * 0.9;
  if (height > knee) height = knee + (height - knee) / (1 + (height - knee) / (WORLD.peak - knee));
  return height - base;
}

type Height = (x: number, z: number) => number;

/** The ground's rise per metre along +X and +Z, by central differences 4 m apart. */
function gradient(height: Height, x: number, z: number): readonly [number, number] {
  const step = 4;
  return [
    (height(x + step, z) - height(x - step, z)) / (2 * step),
    (height(x, z + step) - height(x, z - step)) / (2 * step),
  ];
}

/** Slope in [0, 1] as the ground layers read it: the angle over 90°. */
export function slopeOf(height: Height, x: number, z: number): number {
  return Math.atan(Math.hypot(...gradient(height, x, z))) / (Math.PI / 2);
}

/** The downhill direction at (x, z), unit (x, z), and the fall per metre. */
export function downhill(height: Height, x: number, z: number) {
  const [gx, gz] = gradient(height, x, z),
    fall = Math.hypot(gx, gz);
  return { dir: [-gx / (fall || 1), -gz / (fall || 1)] as const, fall };
}
