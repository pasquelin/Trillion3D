/**
 * Where a forest patch (`props/stands.ts`) may stand, the same way for every region: patches
 * tile a world-aligned grid of their own side, so two regions' forests meet square to square,
 * and each cell is fitted to its ground. The ground is sampled across the square, its fall is
 * read along the grid axis it falls most steeply on, and the variant whose plane misses the
 * samples least is chosen — if its stems stay buried less than their bare bole. The patch
 * stands on the lowest sample, so no stem floats. Level patches turn by quarter turns, which
 * keeps the grid and hides that neighbours are the same mesh; sloped ones turn downhill.
 */
import { TERRAIN_TRIANGLES } from '../plan/budget.ts';
import { WORLD, type Instance } from '../plan/contract.ts';
import { hash01 } from '../props/index.ts';
import { forestStands, STAND_SIDE, type StandBiome, type StandVariant } from '../props/stands.ts';

/**
 * Ground samples per side of a patch, on a lattice neighbouring patches share: no farther apart
 * than the terrain's mean vertex spacing, the finest ground the terrain mesh draws.
 */
export const SAMPLES =
  Math.ceil(STAND_SIDE / Math.sqrt((2 * WORLD.size ** 2) / TERRAIN_TRIANGLES)) + 1;
const STEP = STAND_SIDE / (SAMPLES - 1);

/** The sample offsets across a patch, `[dx, dz]` from its centre, row by row. */
export const standOffsets = Array.from({ length: SAMPLES * SAMPLES }, (_, n) =>
  [Math.floor(n / SAMPLES), n % SAMPLES].map((k) => (k / (SAMPLES - 1) - 0.5) * STAND_SIDE),
);

export type StandSpot = { variant: StandVariant; x: number; z: number; y: number; yaw: number };

/** Ground heights at offsets (dx, dz) from a patch centre, as `[dx, dz, height]`. */
type Samples = readonly (readonly [number, number, number])[];

/** The best fitting variant for the patch centred at (x, z) over `samples`, or none. */
export function fitStand(
  samples: Samples,
  variants: readonly StandVariant[],
  x: number,
  z: number,
  seed: number,
): StandSpot | undefined {
  const moment = samples.reduce((sum, [dx]) => sum + dx * dx, 0),
    gx = samples.reduce((sum, [dx, , h]) => sum + dx * h, 0) / moment,
    gz = samples.reduce((sum, [, dz, h]) => sum + dz * h, 0) / moment;
  // A patch's +X runs downhill: yaw 0 sends it to +X, π to −X, −π/2 to +Z, π/2 to −Z.
  const along = Math.abs(gx) >= Math.abs(gz),
    downhill = along ? (gx > 0 ? Math.PI : 0) : gz > 0 ? Math.PI / 2 : -Math.PI / 2,
    quarter = (Math.floor(hash01(seed, Math.round(x), Math.round(z)) * 4) * Math.PI) / 2;
  let best: StandSpot | undefined,
    span = Infinity;
  for (const variant of variants) {
    const yaw = variant.gradient ? downhill : quarter,
      [cos, sin] = [Math.cos(yaw), Math.sin(yaw)],
      rise = samples.map(([dx, dz, h]) => h + variant.gradient * (dx * cos - dz * sin)),
      low = Math.min(...rise),
      miss = Math.max(...rise) - low;
    if (miss <= variant.tolerance && miss < span) {
      span = miss;
      best = { variant, x, z, y: low, yaw };
    }
  }
  return best;
}

export type StandOptions = {
  seed: number;
  height: (x: number, z: number) => number;
  /** The region's forest cells, `[minX, minZ, side, depth]`, visited deepest first. */
  cells: readonly (readonly [number, number, number, number])[];
  /** The stand at a patch centre, given its ground height and slope (0 flat, 1 vertical). */
  biomeAt: (x: number, z: number, height: number, slope: number) => StandBiome | undefined;
  place: (spot: StandSpot, name: string) => Instance | undefined;
  /** Nodes the whole woodland may take, stands and single trees together. */
  nodes: number;
};

/**
 * Patches on every patch-grid cell whose centre lies in the deeper half of `cells`, deepest
 * first; `place` seats each one and says whether it held. The shallower half is the woodland's
 * margin, where a wood thins out into single trees: it keeps half the woodland's nodes.
 */
export function plantStands(options: StandOptions): { patches: number; trees: number } {
  const { seed, height, biomeAt, place } = options,
    limit = Math.floor(options.nodes / 2),
    { variants } = forestStands(seed),
    sorted = [...options.cells].sort((a, b) => b[3] - a[3] || a[0] - b[0] || a[1] - b[1]),
    cells = sorted.slice(0, Math.ceil(sorted.length / 2));
  let patches = 0,
    trees = 0;
  for (const [minX, minZ, side] of cells) {
    const lattice = new Map<number, number>(),
      at = (i: number, j: number) => {
        const key = i * 4_000_037 + j;
        let h = lattice.get(key);
        if (h === undefined) lattice.set(key, (h = height(i * STEP, j * STEP)));
        return h;
      };
    for (let i = Math.ceil(minX / STAND_SIDE - 0.5); (i + 0.5) * STAND_SIDE < minX + side; i++)
      for (let j = Math.ceil(minZ / STAND_SIDE - 0.5); (j + 0.5) * STAND_SIDE < minZ + side; j++) {
        if (patches >= limit) return { patches, trees };
        const [x, z] = [(i + 0.5) * STAND_SIDE, (j + 0.5) * STAND_SIDE],
          last = SAMPLES - 1,
          samples = standOffsets.map(
            ([dx, dz], n) =>
              [dx, dz, at(i * last + Math.floor(n / SAMPLES), j * last + (n % SAMPLES))] as const,
          );
        const centre = height(x, z),
          rise = Math.max(
            ...samples.map(([dx, dz, h]) => Math.abs(h - centre) / (Math.hypot(dx, dz) || 1)),
          ),
          biome = biomeAt(x, z, centre, Math.atan(rise) / (Math.PI / 2));
        if (!biome) continue;
        const spot = fitStand(
          samples,
          variants.filter((v) => v.biome === biome),
          x,
          z,
          seed,
        );
        if (!spot || !place(spot, `stand-${Math.round(x)}-${Math.round(z)}`)) continue;
        patches++;
        trees += spot.variant.trees;
      }
  }
  return { patches, trees };
}
