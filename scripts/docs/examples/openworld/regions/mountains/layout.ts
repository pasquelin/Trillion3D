/**
 * The mountains' layout, in the order the land asks for: the plan's lakes and rivers are kept
 * clear, its bridges are built, the lake's waterfall runs, the villages take their slopes, the
 * cable car climbs from the resort to the highest summit, the observatory takes a lesser top,
 * the mountain roads are dressed, and the forest and the boulders fill what is left of the node
 * budget.
 */
import type {
  LampLight,
  Marker,
  Mover,
  PropMesh,
  RegionOutput,
  Road,
  WorldPlan,
} from '../../plan/contract.ts';
import { sharedProps } from '../../props/index.ts';
import { placeBridges } from './bridges.ts';
import { scatter } from './forest.ts';
import { placeWaterfalls, planLakes } from './lake.ts';
import { dressLake, dressSummit, placeObservatory, snowPlumes } from './landmarks.ts';
import { CABLE_LINE, placeCableway } from './line.ts';
import { dressPass } from './pass.ts';
import { summits } from './peaks.ts';
import { mountainProps } from './props.ts';
import { footprintRadius, Placer, RoadIndex } from './space.ts';
import { draws } from './terrain.ts';
import { mountainSettlements, placeVillage } from './village.ts';

/** Props that hang in the air over everything else: they claim no ground. */
export const AERIAL = new Set([CABLE_LINE]);

/** Every shared prop's footprint radius, from the shared kit itself. */
const sharedRadii = (seed: number) =>
  sharedProps(seed).map((p) => [p.id, footprintRadius(p)] as const);

/** Rivers kept clear like roads: a band as wide as the river at its widest. */
const riverBands = (plan: WorldPlan): Road[] =>
  plan.rivers.map((river) => ({
    id: river.id,
    class: 'dirt',
    width: Math.max(...river.widths) + 10,
    points: river.points,
  }));

export type MountainsStats = {
  waterfalls: number;
  bridgeSpans: number;
  portals: number;
  missingPylons: number;
  /** Closed-stand patches placed, and the trees they hold. */
  stands: number;
  standTrees: number;
  trees: number;
  rocks: number;
  crags: number;
};

export function layoutMountains(plan: WorldPlan): { output: RegionOutput; stats: MountainsStats } {
  const region = plan.regions.mountains,
    rand = draws(region.seed),
    props: PropMesh[] = mountainProps(region.seed),
    radii = new Map([
      ...sharedRadii(plan.subSeed('props')),
      ...props.map((p) => [p.id, footprintRadius(p)] as const),
    ]),
    roads = new RoadIndex([...plan.roads, ...riverBands(plan)]),
    placer = new Placer(plan, region.bounds, roads, radii, region.budget.nodes),
    lights: LampLight[] = [],
    markers: Marker[] = [],
    movers: Mover[] = [];
  for (const lake of planLakes(plan))
    placer.taken.add({ x: lake.x, z: lake.z, r: lake.radius + 10 });

  const spans = placeBridges(placer),
    falls = placeWaterfalls(placer);
  props.push(...spans, ...falls.meshes);
  for (const lake of falls.lakes) markers.push(...dressLake(placer, lake));

  const settlements = mountainSettlements(placer);
  for (const site of settlements) {
    const village = placeVillage(placer, site, rand);
    lights.push(...village.lights);
    markers.push(...village.markers);
  }

  const tops = summits(placer);
  let missingPylons = 0;
  if (tops.length) {
    markers.push(dressSummit(placer, plan, tops[0]), ...snowPlumes(tops));
    const observatory = placeObservatory(placer, tops);
    lights.push(...observatory.lights);
    movers.push(...observatory.movers);
    markers.push(...observatory.markers);
    if (settlements.length) {
      const cableway = placeCableway(placer, settlements[0].centre, tops[0]);
      if (cableway.line) props.push(cableway.line);
      lights.push(...cableway.lights);
      movers.push(...cableway.movers);
      missingPylons = cableway.missing;
    }
  }

  const pass = dressPass(placer, (x, z) =>
    settlements.some((s) => Math.hypot(x - s.centre[0], z - s.centre[2]) < s.radius),
  );
  props.push(...pass.props);
  lights.push(...pass.lights);
  markers.push(...pass.markers);

  const scattered = scatter(placer, plan.subSeed('mountains/scatter'), rand),
    used = new Set([
      ...placer.instances.map((i) => i.prop),
      ...movers.flatMap((m) => ('model' in m ? [m.model] : [])),
    ]);
  return {
    output: {
      props: props.filter((p) => used.has(p.id)),
      instances: placer.instances,
      lights,
      markers,
      movers,
      roads: [],
    },
    stats: {
      waterfalls: falls.lakes.length,
      bridgeSpans: spans.length,
      portals: pass.portals,
      missingPylons,
      ...scattered,
    },
  };
}
