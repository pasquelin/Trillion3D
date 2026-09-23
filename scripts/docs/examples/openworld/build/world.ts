/**
 * Builds the whole open world from one seed (#332): the plan composed with every region, the
 * terrain tiles, what each region places, and the data the page reads beside the cache.
 */
import {
  WORLD,
  type PropMesh,
  type RegionModule,
  type WorldRuntimeData,
} from '../plan/contract.ts';
import { createPlan } from '../plan/plan.ts';
import { terrainTiles } from '../plan/tiles.ts';
import { HEIGHT_SAMPLES } from '../plan/heights.ts';
import { sharedProps, vehicleProps } from '../props/index.ts';
import { REGIONS } from '../regions/index.ts';
import { solidColliders } from './colliders.ts';
import { fillEmptyLand } from './fill.ts';
import { settleMarkers } from './markers.ts';

/** Keeps the first mesh of each id: regions may hand back the shared props they place. */
function uniqueMeshes(lists: readonly (readonly PropMesh[])[]) {
  const byId = new Map<string, PropMesh>();
  for (const list of lists)
    for (const mesh of list) if (!byId.has(mesh.id)) byId.set(mesh.id, mesh);
  return [...byId.values()];
}

/**
 * The plan and everything the regions place on it, with every teleport and spawn settled where
 * it can stand (`markers.ts`) against the solids the physics collides with (`colliders.ts`); no
 * terrain tiles, so a check over the whole world stays quick.
 */
export function placeWorld(seed: number = WORLD.seed, regions: readonly RegionModule[] = REGIONS) {
  const plan = createPlan(seed, regions),
    placed = regions.map((region) => region.generate(plan)),
    regionInstances = placed.flatMap((output) => output.instances),
    used = new Set(regionInstances.map((instance) => instance.prop)),
    meshes = uniqueMeshes([
      ...placed.map((output) => output.props),
      sharedProps(plan.subSeed('props')),
      vehicleProps(),
    ]).filter((mesh) => used.has(mesh.id)),
    regionSolids = solidColliders(meshes, regionInstances),
    fill = fillEmptyLand(
      plan,
      regions.map((region) => region.name),
      placed.map((output) => output.instances),
      meshes,
      (prop) => regionSolids.shapes.has(prop),
    ),
    instances = [...regionInstances, ...fill.instances],
    solids = solidColliders(meshes, instances),
    markers = settleMarkers(
      { plan, meshes, instances, solids },
      placed.flatMap((output) => output.markers),
    );
  return { plan, placed, meshes, instances, solids, markers, fill };
}

export function buildWorld(seed: number = WORLD.seed, regions: readonly RegionModule[] = REGIONS) {
  const { plan, placed, meshes, instances, solids, markers } = placeWorld(seed, regions),
    terrain = terrainTiles(plan, regions),
    lights = placed.flatMap((output) => output.lights);
  const data: WorldRuntimeData = {
    seed,
    size: WORLD.size,
    tile: WORLD.tile,
    heightSamples: HEIGHT_SAMPLES,
    roads: [...plan.roads, ...placed.flatMap((output) => output.roads)],
    settlements: plan.settlements,
    markers,
    movers: placed.flatMap((output) => output.movers),
    lights,
  };
  return { plan, terrain, objects: { meshes, instances, lights }, solids, data };
}
