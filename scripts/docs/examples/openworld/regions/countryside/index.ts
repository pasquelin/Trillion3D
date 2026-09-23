/**
 * Countryside and forest (#332): the centre of the map, its largest land, where a visitor walks
 * most. Rolling hills over the plan's relief; a patchwork of fields — wheat, rapeseed, lavender,
 * pasture, ploughed earth — draped over the ground round each farm, hedged and walled; farms with
 * a farmhouse, a gambrel barn, silos, a tractor and hay bales, joined to the road network by dirt
 * tracks; orchards; dense woods of the kit's oaks, birches and pines under a closed canopy, bushes
 * at their feet; villages on the plan's settlements,
 * each with a church and bell tower on a cobbled square, houses with gardens, lanterns and
 * street lamps; stone arch bridges on the plan's river crossings; a jetty on the lake; a tower
 * windmill whose sails turn.
 *
 * Teleports: the village square, the hilltop viewpoint (turned toward the world's highest peak),
 * a clearing deep in the woods, the windmill. A car spawns on the square of the largest village.
 * Emitters: birds over the farms, fireflies by the rivers and the lake, dust on the dirt tracks.
 * Movers: the windmill's sails, tractors driving the tracks.
 *
 * Budgets: the woods take every node the other placements leave; the fields take the triangles
 * the region's other props leave, never meshed finer than the terrain they lie on.
 */
import {
  WORLD,
  type Instance,
  type Marker,
  type RegionModule,
  type RegionOutput,
  type WorldPlan,
} from '../../plan/contract.ts';
import { TERRAIN_TRIANGLES } from '../../plan/budget.ts';
import { isTerrainPlan } from '../../plan/plan.ts';
import {
  placeLamps,
  sharedProps,
  STREET_LAMP_LIGHTS,
  triangleCount,
  type PropLamp,
} from '../../props/index.ts';
import { buildings } from './farm-buildings.ts';
import { churchSquare } from './church.ts';
import { placeFarms } from './farms.ts';
import { fieldMesh, fieldTriangles } from './fields.ts';
import { crownRadius, deepestWood, plantForests } from './forests.ts';
import { GROUND, refineHills } from './ground.ts';
import { land } from './land.ts';
import { clearing, placeWindmill, viewpoint } from './landmarks.ts';
import { farmLife, fireflies } from './life.ts';
import { hayBales, tractor, windmillSails, windmillTower } from './machines.ts';
import { natureProps } from './nature.ts';
import { Site } from './site.ts';
import { placeVillages, squareCentre } from './villages.ts';
import { bridgeSpan, jetty, placeBridge, placeJetty } from './water.ts';
import { EYE } from '../../build/markers.ts';

/**
 * Unique triangles of the region's own props: the lead's target for #332 (dense meshes shared
 * by many nodes), which the plan's cache share for the countryside does not yet reflect.
 */
export const TRIANGLES = 400_000;

/**
 * Mean vertex spacing of the terrain the fields lie on, metres: a drape finer than the ground
 * under it follows nothing more, so no field is meshed finer.
 */
const GROUND_SPACING = Math.sqrt((2 * WORLD.size ** 2) / TERRAIN_TRIANGLES);

/** The region's own props, and the lamps each one carries. */
function catalogue(seed: number) {
  const built = buildings(),
    [church, churchLamps] = churchSquare(),
    [pier, pierLamps] = jetty();
  return {
    props: [
      ...built.props,
      church,
      bridgeSpan(),
      pier,
      windmillTower(),
      windmillSails(),
      tractor(),
      hayBales(),
      ...natureProps(seed),
    ],
    lamps: new Map<string, readonly PropLamp[]>([
      ...built.lamps,
      [church.id, churchLamps],
      [pier.id, pierLamps],
      ['street-lamp', STREET_LAMP_LIGHTS],
    ]),
  };
}

/** The teleport and the car spawn on the square of the largest village that got one. */
function squareMarkers(squares: readonly (Instance | undefined)[]): Marker[] {
  const square = squares.find(Boolean);
  if (!square) return [];
  const [x, y, z] = squareCentre(square);
  return [
    {
      kind: 'teleport',
      name: 'countryside/village-square',
      position: [x, y + EYE, z],
      yaw: square.yaw + Math.PI,
    },
    {
      kind: 'spawn',
      vehicle: 'car',
      name: 'countryside/village-car',
      position: [x, y, z],
      yaw: square.yaw + Math.PI / 2,
    },
  ];
}

function generate(plan: WorldPlan): RegionOutput {
  const { bounds, seed, budget } = plan.regions.countryside,
    // The lakes the plan carved and the viewpoints its trails lead to, when it publishes them.
    terrain = isTerrainPlan(plan) ? plan : undefined,
    shared = sharedProps(plan.seed),
    inside = (x: number, z: number) =>
      x > bounds.minX && x < bounds.maxX && z > bounds.minZ && z < bounds.maxZ,
    { props, lamps } = catalogue(seed),
    site = new Site(
      plan,
      bounds,
      (terrain?.lakes ?? []).filter((lake) => inside(lake.x, lake.z)),
    ),
    country = land(plan, plan.subSeed('countryside/land')),
    sub = (name: string) => plan.subSeed(`countryside/${name}`);
  site.register([...props, ...shared]);
  for (const bridge of plan.bridges)
    if (inside(bridge.from[0], bridge.from[2])) placeBridge(site, bridge);
  const villages = placeVillages(
    site,
    [...country.villages].sort((a, b) => b.radius - a.radius),
    sub('villages'),
  );
  site.lakes.forEach((lake) => placeJetty(site, lake, (sub(lake.id) % 6283) / 1000));
  const markers = squareMarkers(villages.map((v) => v.square));
  for (const marker of [
    viewpoint(
      site,
      sub('viewpoint'),
      (terrain?.viewpoints ?? []).filter(([x, , z]) => inside(x, z)),
    ),
    clearing(site, deepestWood(site, country)),
  ])
    if (marker) markers.push(marker);
  const mill = placeWindmill(site, country, sub('windmill')),
    farms = placeFarms(site, country, sub('farms')),
    fields = farms.flatMap((farm) => farm.fields);
  plantForests(
    site,
    country,
    budget.nodes - fields.length,
    2 * crownRadius(shared),
    sub('forests'),
  );
  // The fields take the triangles the other props leave, spread evenly over their area.
  const area = fields.reduce((sum, { rect }) => sum + 4 * rect.hx * rect.hz, 0),
    room = TRIANGLES - props.reduce((sum, p) => sum + triangleCount(p), 0);
  let step = Math.max(GROUND_SPACING, Math.sqrt((2 * area) / Math.max(1, room)));
  while (fields.reduce((sum, field) => sum + fieldTriangles(field, step), 0) > room) step *= 1.05;
  const draped = fields.map((field) => fieldMesh(plan, field, step));
  const instances = [...site.instances, ...draped.map(([, instance]) => instance)],
    lights = instances.flatMap((instance) => {
      const own = lamps.get(instance.prop);
      return own ? placeLamps(own, instance) : [];
    }),
    life = farmLife(farms);
  return {
    props: [...props, ...draped.map(([mesh]) => mesh)],
    instances,
    lights,
    markers: [...markers, ...mill.markers, ...life.markers, ...fireflies(site)],
    movers: [...mill.movers, ...life.movers],
    roads: farms.flatMap((farm) => (farm.track ? [farm.track] : [])),
  };
}

export const countrysideRegion: RegionModule = {
  name: 'countryside',
  refine: refineHills,
  ground: GROUND,
  generate,
};
