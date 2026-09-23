/**
 * Forest patches: a square of closed stand merged into ONE shared mesh, so a forest is a few
 * thousand nodes of a handful of meshes instead of a node per tree — the way the engine shares
 * its pages. Stems stand evenly spread at the stem density forestry measures for the stand, each
 * scaled as the single trees are; an understory of shrubs fills the gaps.
 *
 * A patch is rigid, so it is built on a plane: its stems rise from ground falling toward +X at
 * a gradient, and the region turns it so +X runs downhill. A stem may be buried by its bare
 * bole (`stand-trees.ts`) and no deeper, which sets how far a plane may miss the ground; the
 * variants of a biome step their gradient by twice that miss over the side, from level ground
 * to the angle of repose, where soil — and the forest on it — stops.
 */
import type { MeshPart, PropMesh } from '../plan/contract.ts';
import { REPOSE } from '../plan/rivers.ts';
import { triangleCount } from './geometry.ts';
import { hash01 } from './noise.ts';
import { gaps, spread } from './spacing.ts';
import { boleHeight, shrub, standTree } from './stand-trees.ts';
import { prop, transform } from './transform.ts';
import type { TreeSpecies } from './trees.ts';

export type StandBiome = 'alpine' | 'broadleaf' | 'birch' | 'palm';

type Stand = {
  mix: readonly (readonly [TreeSpecies, number])[];
  /** Stems per hectare. */
  density: number;
  /** Steepest ground gradient the stand grows on (rise over run). */
  steepest: number;
  understory: boolean;
};

/**
 * The stands, their densities from forestry references:
 * - alpine: mature subalpine Norway spruce, 400–800 stems/ha in the yield tables of
 *   Picea abies (E. Assmann, F. Franz, "Vorläufige Fichten-Ertragstafel für Bayern", 1963);
 *   the lower half, the old stands a visitor sees, with a tenth of birch.
 * - broadleaf: mature oak and beech, 200–400 stems/ha (R. Schober, "Ertragstafeln wichtiger
 *   Baumarten", 1975: beech after Schober 1967, oak after Jüttner 1955), with birch and pine.
 * - birch: silver-birch stands at 30–50 years, 600–1 100 stems/ha (Finnish yield tables,
 *   M. Oikarinen, 1983).
 * - palm: a date-palm grove planted 8 m apart, 156 palms/ha — FAO's spacing of 8–10 m
 *   (A. Zaid, P. F. de Wet, "Date palm cultivation", FAO Plant Production and Protection Paper
 *   156, 2002); a grove is levelled for irrigation, so it grows on flat ground only.
 */
const STANDS: Record<StandBiome, Stand> = {
  alpine: {
    mix: [
      ['pine', 0.9],
      ['birch', 0.1],
    ],
    density: 500,
    steepest: REPOSE,
    understory: true,
  },
  broadleaf: {
    mix: [
      ['oak', 0.6],
      ['birch', 0.2],
      ['pine', 0.2],
    ],
    density: 300,
    steepest: REPOSE,
    understory: true,
  },
  birch: { mix: [['birch', 1]], density: 700, steepest: REPOSE, understory: true },
  palm: { mix: [['palm', 1]], density: 1e4 / 8 ** 2, steepest: 0, understory: false },
};

/**
 * Side of a patch, metres: a design. A patch is one node, so the nodes a forest takes fall as
 * the square of the side, and the unique triangles of each variant grow as it.
 */
export const STAND_SIDE = 32;
/** Scale spread of the stems, as the regions scatter their single trees. */
const SCALE: readonly [number, number] = [0.75, 1.25];
/** Distinct stems grown per species for one patch, each placed turned and scaled. */
const STEMS = 3;

export type StandVariant = {
  id: string;
  biome: StandBiome;
  gradient: number;
  side: number;
  trees: number;
  /** How far the ground may rise above the patch's plane, metres. */
  tolerance: number;
};

/** How far the ground may rise above a patch's plane of `biome`: its shortest bare bole, m. */
export const standTolerance = (biome: StandBiome) =>
  Math.min(...STANDS[biome].mix.map(([species]) => boleHeight(species))) * SCALE[0];

/** One patch of `biome`, its stems on ground of `gradient` falling toward +X. */
export function forestPatch(id: string, biome: StandBiome, gradient: number, seed: number) {
  const stand = STANDS[biome],
    count = Math.round((stand.density * STAND_SIDE * STAND_SIDE) / 1e4),
    stems = spread(STAND_SIDE, count, seed),
    grown = new Map<string, MeshPart[]>(),
    parts: MeshPart[] = [];
  const grow = (species: TreeSpecies, k: number) => {
    const key = `${species}-${k}`;
    if (!grown.has(key)) grown.set(key, standTree(species, seed + k * 7919));
    return grown.get(key)!;
  };
  stems.forEach(([x, z], n) => {
    let pick = hash01(seed, n, 3);
    const species = stand.mix.find(([, share]) => (pick -= share) < 0)?.[0] ?? stand.mix[0][0],
      scale = SCALE[0] + (SCALE[1] - SCALE[0]) * hash01(seed, n, 4),
      at = [x, -gradient * x, z] as const;
    for (const part of grow(species, Math.floor(hash01(seed, n, 5) * STEMS)))
      parts.push(transform(part, { at, yaw: hash01(seed, n, 6) * 6.2832, scale }));
  });
  if (stand.understory) {
    // Shrubs keep half the stems' mean spacing from every stem and from each other.
    const leaf = shrub(seed),
      spacing = Math.sqrt(1e4 / stand.density);
    gaps(STAND_SIDE, count, spacing / 2, seed + 2, stems).forEach(([x, z], n) =>
      parts.push(
        transform(leaf, {
          at: [x, -gradient * x, z],
          yaw: n,
          scale: 0.6 + 0.8 * hash01(seed, n, 7),
        }),
      ),
    );
  }
  return { mesh: prop(id, parts), trees: stems.length };
}

/** The gradients a biome's variants are built for: level, then one step per burial span. */
function gradients(biome: StandBiome, tolerance: number) {
  const step = (2 * tolerance) / STAND_SIDE,
    last = Math.ceil(Math.max(0, STANDS[biome].steepest - step / 2) / step);
  return Array.from({ length: last + 1 }, (_, k) => k * step);
}

const built = new Map<number, { meshes: PropMesh[]; variants: StandVariant[] }>();

/** Every patch variant of every biome, built once per seed; ids `tree-stand-<biome>-<k>`. */
export function forestStands(seed: number) {
  let catalogue = built.get(seed);
  if (catalogue) return catalogue;
  catalogue = { meshes: [], variants: [] };
  (Object.keys(STANDS) as StandBiome[]).forEach((biome, b) => {
    const tolerance = standTolerance(biome);
    gradients(biome, tolerance).forEach((gradient, k) => {
      const id = `tree-stand-${biome}-${k}`,
        patch = forestPatch(id, biome, gradient, seed + b * 101 + k);
      catalogue.meshes.push(patch.mesh);
      catalogue.variants.push({
        id,
        biome,
        gradient,
        side: STAND_SIDE,
        trees: patch.trees,
        tolerance,
      });
    });
  });
  built.set(seed, catalogue);
  return catalogue;
}

/**
 * The ground a patch claims, `[minX, minZ, maxX, maxZ]`, or undefined for any other prop: the
 * square its stems stand in. Its crowns overhang the neighbouring patches as any tree's do.
 */
export const standExtent = (id: string) =>
  id.startsWith('tree-stand-')
    ? ([-STAND_SIDE / 2, -STAND_SIDE / 2, STAND_SIDE / 2, STAND_SIDE / 2] as const)
    : undefined;

/** Unique triangles of every patch variant together. */
export const standTriangles = (seed: number) =>
  forestStands(seed).meshes.reduce((sum, mesh) => sum + triangleCount(mesh), 0);
