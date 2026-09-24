/**
 * The world plan (#332): one seed and the region modules make every height, biome, river, road
 * and settlement of the 8 × 8 km world. The height is composed in one fixed order — global
 * relief, region refinements faded by the biome weights, erosion, river and lake cuts, the
 * airport platform, road earthworks — so any module reading `plan.height` reads the ground the
 * tiles are built from, and no seam can appear between two regions.
 */
import type { Biome, Bridge, RegionModule, RegionName, Vec3, WorldPlan } from './contract.ts';
import { WORLD } from './contract.ts';
import {
  platformLeveller,
  roadLeveller,
  waterCarver,
  type Lake,
  type Platform,
  type RoadCourse,
} from './carve.ts';
import { REGION_BOUNDS, REGIONS, landWeights } from './layout.ts';
import { planWaters, relevel } from './waters.ts';
import { planNetwork } from './network.ts';
import { nameSeed, smoothstep } from './noise.ts';
import { regionBudgets } from './budget.ts';
import { erodedGround } from './eroded.ts';
import { SHORE, type ErosionFields } from './erosion.ts';
import { createRelief, type Relief } from './relief.ts';
import type { Ground } from './roads.ts';
import { heightGrid } from './route.ts';
import { planSettlements } from './settlements.ts';
import type { Tunnel } from './tunnels.ts';

/**
 * The plan `createPlan` returns: the contract's `WorldPlan` plus what the plan knows beyond it.
 * A region's `generate` receives it typed as `WorldPlan`; a region that reads the lakes, the
 * natural ground or the tunnels imports this type and narrows with `isTerrainPlan`.
 */
export type TerrainPlan = WorldPlan & {
  relief: Relief;
  /** Relief plus region refinements, before the erosion. */
  uneroded(x: number, z: number): number;
  /** The same, eroded, before any cut: where the sea is. */
  natural(x: number, z: number): number;
  /** What the erosion left: loose ground, cut rock and running water, for the ground paint. */
  erosion: ErosionFields;
  lakes: readonly Lake[];
  platform: Platform;
  courses: readonly RoadCourse[];
  /** The ground before road earthworks: the natural ground, river and lake cuts, the airport. */
  beforeRoads(x: number, z: number): number;
  /** Road runs bored through ridges: the ground over them is left whole, a portal at each end. */
  tunnels: readonly Tunnel[];
  viewpoints: readonly Vec3[];
};

export const isTerrainPlan = (plan: WorldPlan): plan is TerrainPlan =>
  'natural' in plan && 'lakes' in plan && 'tunnels' in plan;

/**
 * The sub-seed of a named part of the world made from `worldSeed`: what `plan.subSeed(name)`
 * returns, available before a plan exists. A region's `refine` receives no seed, because the
 * plan composes it into its height before anything else; the example has one world, so a
 * region binds its refinement to `subSeedOf(WORLD.seed, 'region/<name>')`, which is the
 * `plan.regions[name].seed` its `generate` later reads.
 */
export const subSeedOf = (worldSeed: number, name: string) => nameSeed(worldSeed, name);

export function createPlan(
  seed: number = WORLD.seed,
  regions: readonly RegionModule[] = [],
): TerrainPlan {
  const subSeed = (name: string) => subSeedOf(seed, name),
    relief = createRelief(subSeed('relief')),
    refiners = REGIONS.map((name) => regions.find((module) => module.name === name)?.refine),
    weights = new Float64Array(REGIONS.length),
    refined = refiners.some(Boolean);
  const uneroded = (x: number, z: number) => {
    const base = relief.height(x, z);
    if (!refined) return base;
    landWeights(x, z, weights);
    let height = base;
    refiners.forEach((refine, index) => {
      if (refine && weights[index] > 0) height += weights[index] * refine(x, z, base);
    });
    return height;
  };
  // The platform, the rivers and the lakes are found on the uneroded ground and kept out of the
  // erosion, which drains into them as its base level: sediment settles at their banks and
  // never fills them. A lake reads its level again on its eroded rim.
  const waters = planWaters(heightGrid(uneroded), uneroded, relief),
    { platform, mouth, rivers } = waters,
    { natural, erosion } = erodedGround(seed, refiners, uneroded, waters),
    naturalGrid = heightGrid(natural),
    lakes = waters.lakes.map((lake) => relevel(naturalGrid, lake));
  const water = waterCarver(rivers, lakes, naturalGrid),
    level = platformLeveller(platform, 400),
    carved = (x: number, z: number) => level(x, z, water(x, z, natural(x, z))),
    ground: Ground = {
      grid: heightGrid(carved),
      height: carved,
      wet: (x, z) =>
        natural(x, z) < 0.5 || lakes.some((l) => Math.hypot(x - l.x, z - l.z) < l.radius + 30),
      rivers,
    };
  const settlements = planSettlements(
      ground,
      subSeed('settlements'),
      mouth,
      platform,
      relief.islands,
    ),
    network = planNetwork(ground, settlements, lakes, platform),
    roads = roadLeveller(network.courses),
    height = (x: number, z: number) => roads(x, z, carved(x, z)),
    budgets = regionBudgets();
  const biomeWeights = new Float64Array(REGIONS.length);
  const biome = (x: number, z: number) => {
    const sea = smoothstep(SHORE, -SHORE, natural(x, z)),
      out: Partial<Record<Biome, number>> = {};
    let owner: Biome = 'sea',
      top = sea;
    if (sea > 0) out.sea = sea;
    landWeights(x, z, biomeWeights);
    REGIONS.forEach((name, index) => {
      const weight = biomeWeights[index] * (1 - sea);
      if (weight <= 0) return;
      out[name] = weight;
      if (weight > top) [owner, top] = [name, weight];
    });
    return { owner, weights: out };
  };
  return {
    seed,
    height,
    biome,
    regions: Object.fromEntries(
      REGIONS.map((name) => [
        name,
        { bounds: REGION_BOUNDS[name], seed: subSeed(`region/${name}`), budget: budgets[name] },
      ]),
    ) as Record<RegionName, WorldPlan['regions'][RegionName]>,
    roads: network.courses.map((course) => course.road),
    rivers: rivers.map((course) => course.river),
    bridges: network.bridges as readonly Bridge[],
    settlements,
    subSeed,
    relief,
    uneroded,
    natural,
    erosion,
    beforeRoads: carved,
    lakes,
    platform,
    courses: network.courses,
    tunnels: network.tunnels,
    viewpoints: network.viewpoints,
  };
}
