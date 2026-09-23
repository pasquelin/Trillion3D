/**
 * Tablelands and the canyon: flat-topped rock left standing when softer ground around it wore
 * away. A mesa is wider than it is tall, a butte taller than wide, a plateau kilometres across
 * with a canyon cut through it and a dry riverbed (wadi) on its floor. Mesas and buttes stand
 * on jittered grid cells of their own, so the field holds anywhere without a list.
 */
import type { Bounds } from '../../plan/contract.ts';
import { REGION_BOUNDS } from '../../plan/layout.ts';
import { benches, FIELD_SEED, hash01, smoothstep, valueNoise } from './field.ts';

type TablelandKind = 'mesa' | 'butte' | 'plateau';
export type Tableland = {
  kind: TablelandKind;
  x: number;
  z: number;
  radius: number;
  height: number;
  seed: number;
};

const DEG = Math.PI / 180;
/** The cliff takes the upper 60 % of the height, benched; talus (scree) the rest. */
const CLIFF_SHARE = 0.6;
/** Mean cliff slope 60° (risers near 75° between treads); concave talus averaging 20°. */
export const CLIFF_RUN = 1 / Math.tan(60 * DEG);
const TALUS_RUN = 1 / Math.tan(20 * DEG);
/** One bench per stratum; Colorado Plateau formations are tens of metres thick. */
export const STRATUM = 24;

/** Horizontal extent of the cliff and of the talus below it, for a tableland of `height`. */
export function slopes(height: number) {
  const cliff = height * CLIFF_SHARE;
  return { cliff, cliffRun: cliff * CLIFF_RUN, talusRun: (height - cliff) * TALUS_RUN };
}

/** Rim radius toward `angle`: an eroded outline, never a circle. */
export function rimRadius(t: Tableland, angle: number): number {
  const wobble = valueNoise(t.seed, 4 + 2.5 * Math.cos(angle), 4 + 2.5 * Math.sin(angle));
  return t.radius * (1 + 0.16 * wobble);
}

/** Height above the plain `e` metres outside the rim (≤ 0 inside), for a tableland `height`. */
export function tablelandProfile(e: number, height: number): number {
  const { cliff, cliffRun, talusRun } = slopes(height);
  if (e <= 0) return height;
  if (e <= cliffRun)
    return height - cliff * benches(e / cliffRun, Math.max(2, Math.round(cliff / STRATUM)), 0.45);
  if (e <= cliffRun + talusRun) return (height - cliff) * (1 - (e - cliffRun) / talusRun) ** 2;
  return 0;
}

const MESA_CELL = 3000;

/**
 * The desert's one plateau, seeded inside the region's rectangle of the world layout (a static
 * table, so `refine` may read it without the plan): clear of the borders by its talus, in the
 * northern half, away from the southern coast.
 */
const PLATEAU: Tableland = (() => {
  const { minX, maxX, minZ, maxZ } = REGION_BOUNDS.desert,
    seed = FIELD_SEED + 1000,
    radius = 2400 + 600 * hash01(seed, 4),
    clear = radius * 1.4 + 500;
  return {
    kind: 'plateau',
    x: minX + clear + (maxX - minX - 2 * clear) * hash01(seed, 2),
    z: minZ + clear + ((maxZ - minZ) / 2 - clear) * hash01(seed, 3),
    radius,
    height: 150 + 70 * hash01(seed, 5),
    seed,
  };
})();

/** Mesa cells already decided: the world has a few hundred, the plan asks millions of times. */
const mesas = new Map<string, Tableland | undefined>();

function mesaAt(i: number, j: number): Tableland | undefined {
  const key = `${i},${j}`;
  if (!mesas.has(key)) mesas.set(key, decideMesa(i, j));
  return mesas.get(key);
}

function decideMesa(i: number, j: number): Tableland | undefined {
  const seed = FIELD_SEED + 2000 + ((i * 83492791) ^ (j * 2654435761)),
    roll = hash01(seed, 1);
  if (roll > 0.45) return undefined;
  const butte = roll > 0.22,
    x = (i + 0.4 + 0.2 * hash01(seed, 2)) * MESA_CELL,
    z = (j + 0.4 + 0.2 * hash01(seed, 3)) * MESA_CELL;
  // No mesa inside the plateau's reach: the plateau already owns that ground.
  if (Math.hypot(x - PLATEAU.x, z - PLATEAU.z) < PLATEAU.radius * 2.4) return undefined;
  return butte
    ? {
        kind: 'butte',
        x,
        z,
        radius: 110 + 130 * hash01(seed, 4),
        height: 70 + 80 * hash01(seed, 5),
        seed,
      }
    : {
        kind: 'mesa',
        x,
        z,
        radius: 350 + 300 * hash01(seed, 4),
        height: 90 + 110 * hash01(seed, 5),
        seed,
      };
}

/** Every tableland of one grid whose cell overlaps the window [x0, x1] × [z0, z1]. */
function sites(cell: number, at: (i: number, j: number) => Tableland | undefined, b: Bounds) {
  const out: Tableland[] = [];
  for (let i = Math.floor(b.minX / cell); i <= Math.floor(b.maxX / cell); i++)
    for (let j = Math.floor(b.minZ / cell); j <= Math.floor(b.maxZ / cell); j++) {
      const t = at(i, j);
      if (t) out.push(t);
    }
  return out;
}

/** Tablelands whose relief can reach (x, z): the plateau, then neighbouring mesa cells. */
export const tablelandsNear = (x: number, z: number) => [
  PLATEAU,
  ...sites(MESA_CELL, mesaAt, {
    minX: x - MESA_CELL,
    maxX: x + MESA_CELL,
    minZ: z - MESA_CELL,
    maxZ: z + MESA_CELL,
  }),
];

const inside = (t: Tableland, b: Bounds) =>
  t.x >= b.minX && t.x <= b.maxX && t.z >= b.minZ && t.z <= b.maxZ;

/** Tablelands centred inside `bounds`, the plateau first. */
export const tablelandsIn = (bounds: Bounds) =>
  [PLATEAU, ...sites(MESA_CELL, mesaAt, bounds)].filter((t) => inside(t, bounds));

/** Wadi floor half-width, metres; meanders follow Leopold & Wolman: λ ≈ 11 w, amplitude ≈ 2.7 w. */
export const WADI_HALF = 30;
/** How deep the wadi cuts below the plain, metres. */
const WASH = 6;

/** The canyon's frame through a plateau: `s` along its axis, `n` across, `offset(s)` meander. */
export function canyonFrame(p: Tableland) {
  const angle = hash01(p.seed, 9) * Math.PI,
    c = Math.cos(angle),
    s = Math.sin(angle),
    width = 2 * WADI_HALF;
  const offset = (along: number) =>
    2.7 * width * Math.sin((2 * Math.PI * along) / (11 * width) + p.seed) +
    width * valueNoise(p.seed + 5, along / (11 * width), 0);
  return {
    angle,
    reach: p.radius * 2.2,
    offset,
    local: (x: number, z: number) => ({
      s: (x - p.x) * c + (z - p.z) * s,
      n: -(x - p.x) * s + (z - p.z) * c,
    }),
    world: (along: number, across: number) => ({
      x: p.x + along * c - across * s,
      z: p.z + along * s + across * c,
    }),
  };
}

/** Share of the carve at `d` metres from the wadi's axis: 1 on the floor, benched walls, 0 out. */
function canyonProfile(d: number, depth: number): number {
  const run = depth * CLIFF_RUN;
  if (d <= WADI_HALF) return 1;
  if (d >= WADI_HALF + run) return 0;
  return 1 - benches((d - WADI_HALF) / run, Math.max(2, Math.round(depth / STRATUM)), 0.45);
}

/** Height a plateau's canyon removes at (x, z), given the plateau's own height there. */
export function canyonCarve(p: Tableland, x: number, z: number, above: number): number {
  const frame = canyonFrame(p),
    { s, n } = frame.local(x, z);
  if (Math.abs(s) > frame.reach) return 0;
  const fade = 1 - smoothstep(p.radius * 1.3, frame.reach, Math.abs(s));
  return canyonProfile(Math.abs(n - frame.offset(s)), above + WASH) * (above + WASH * fade);
}
