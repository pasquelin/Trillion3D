/**
 * The cache budget of the world (#332), derived from the published envelope and the measured cook
 * costs: a twentieth of the envelope is kept as margin, the regions take what they ask for, and
 * the terrain takes everything left — its triangles and its baked ground textures together.
 */
import { COOK_COST, WORLD, type Budget, type RegionName } from './contract.ts';

/** Share of the envelope kept free: the cook costs are measured on the whole terrain cook. */
export const MARGIN = 0.05;
const TILES = (WORLD.size / WORLD.tile) ** 2;

/**
 * What each region asks for: placed nodes (how much it scatters) and unique prop triangles (how
 * many distinct models it draws). A design of the world's content, not a measurement.
 */
const DEMAND: Record<RegionName, Budget> = {
  countryside: { nodes: 90_000, triangles: 400_000 },
  city: { nodes: 80_000, triangles: 400_000 },
  mountains: { nodes: 50_000, triangles: 400_000 },
  coast: { nodes: 40_000, triangles: 400_000 },
  desert: { nodes: 25_000, triangles: 400_000 },
  airport: { nodes: 15_000, triangles: 400_000 },
};

/** Bytes a budget adds to the published cache. */
export const cacheBytes = (budget: Budget) =>
  budget.triangles * COOK_COST.bytesPerTriangle + budget.nodes * COOK_COST.bytesPerNode;

/** What the envelope holds once the margin and the terrain's one node per tile are taken. */
const OPEN = WORLD.cacheBytes * (1 - MARGIN) - TILES * COOK_COST.bytesPerNode;

/** Each region's budget: its demand, scaled down together only if the demands overflow. */
export function regionBudgets(): Record<RegionName, Budget> {
  const demanded = Object.values(DEMAND).reduce((sum, budget) => sum + cacheBytes(budget), 0),
    scale = Math.min(1, OPEN / demanded);
  return Object.fromEntries(
    Object.entries(DEMAND).map(([name, { nodes, triangles }]) => [
      name,
      { nodes: Math.floor(nodes * scale), triangles: Math.floor(triangles * scale) },
    ]),
  ) as Record<RegionName, Budget>;
}

/** Bytes the terrain's triangles and ground textures share: what the regions leave. */
export const TERRAIN_BYTES = Math.floor(
  OPEN - Object.values(regionBudgets()).reduce((sum, budget) => sum + cacheBytes(budget), 0),
);

/**
 * The most triangles the terrain can hold: its whole share spent on geometry, before the ground
 * textures take theirs. An upper bound; the build publishes the count it reached.
 */
export const TERRAIN_TRIANGLES = Math.floor(TERRAIN_BYTES / COOK_COST.bytesPerTriangle);

/** Published bytes of one square ground texture of side `size`, at the measured cook cost. */
export function textureBytes(size: number): number {
  return Math.ceil(size * size * COOK_COST.bytesPerTexel);
}
