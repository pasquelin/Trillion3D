/**
 * # Airport
 *
 * The airport lies inland, east of the city, on the flat platform the plan levels for it, and
 * the highway links it to the city. Two parallel 3 km runways run along the platform's long side,
 * painted as the rules have them — threshold keys, designators computed from their real compass
 * bearing, touchdown and aiming-point marks, centreline dashes, edge lines — and lit by edge,
 * centreline, threshold and approach lights, PAPIs and windsocks, with localizers past the ends.
 * A parallel taxiway and the apron taxiway with their connectors, yellow centrelines, blue edge
 * lights and holding points link them to the apron.
 *
 * The terminal is a vaulted hall on steel trees between two wings of bays, each with a
 * full-height glass curtain wall on a grid of mullions; nine contact gates reach nose-in
 * airliners through jet bridges, remote stands are served by stairs trucks, and tugs, baggage
 * trains and fuel bowsers work around them. West stand arched maintenance hangars with open
 * doors and the general-aviation park; east the cargo sheds, container stacks and a freighter.
 * Landside: a control tower with a glazed cab and a rotating beacon, a turning radar, a fuel farm
 * with its pipe racks, and a large car park of parked cars under lamps. A fence closes the
 * airside.
 *
 * At night the runway and taxiway lights glow, floodlight masts light the stands and a share of
 * the car-park lamps are real lights. An airliner flies the circuit on a loop, another taxis, a
 * bus shuttles on the apron. Teleports: the terminal, the control tower's roof (the viewpoint), the
 * runway threshold; the player's plane waits on runway 1 and a car in the car park.
 */
import type { RegionModule, RegionOutput, WorldPlan } from '../../plan/contract.ts';
import { hash01 } from '../../props/index.ts';
import { apron } from './apron.ts';
import type { Context } from './context.ts';
import { buildings, carPark, CAR_PARK, fence } from './landside.ts';
import { maintenance } from './maintenance.ts';
import { markers, node } from './markers.ts';
import { movers } from './motion.ts';
import { GROUND } from './palette.ts';
import { Placer } from './placer.ts';
import { planting } from './planting.ts';
import { airportProps } from './props.ts';
import { airportRoads } from './roads.ts';
import { designator, runway } from './runways.ts';
import { FIELD, siteOf } from './site.ts';
import { taxiways } from './taxiways.ts';
import { RADAR_HEIGHT, TOWER_BEACON } from './tower.ts';

/** Nodes kept free of the budget for whatever the page or the lead adds later. */
const RESERVE = 0.05;

/**
 * Shallow drainage swales across the grass, ±1.2 m over 240 m cells, smoothly interpolated.
 * The plan levels its platform on top, so the field itself stays flat.
 */
// `refine` receives no seed: the swales use a fixed key, the same in every world.
function refine(x: number, z: number): number {
  const cell = 240,
    [fx, fz] = [x / cell, z / cell],
    [ix, iz] = [Math.floor(fx), Math.floor(fz)],
    smooth = (v: number) => v * v * (3 - 2 * v),
    [u, v] = [smooth(fx - ix), smooth(fz - iz)],
    at = (i: number, j: number) => hash01(0x41495250, ix + i, iz + j) * 2 - 1;
  const top = at(0, 0) * (1 - u) + at(1, 0) * u,
    bottom = at(0, 1) * (1 - u) + at(1, 1) * u;
  return 1.2 * (top * (1 - v) + bottom * v);
}

/** The whole layout: the region's output, and every placed node with its footprint. */
export function layout(plan: WorldPlan) {
  const site = siteOf(plan),
    roads = airportRoads(plan, site),
    ctx: Context = {
      plan,
      site,
      placer: new Placer(plan, [...plan.roads, ...roads]),
      seed: plan.regions.airport.seed,
      lights: [],
    };
  // The large things claim their ground first; the car park fills what the budget leaves.
  apron(ctx);
  maintenance(ctx);
  buildings(ctx);
  for (const t of FIELD.runways) runway(ctx, t);
  taxiways(ctx);
  fence(ctx);
  planting(ctx);
  const segments = Math.floor((CAR_PARK.to - CAR_PARK.from) / 52),
    bays = CAR_PARK.rows * segments * 40,
    free =
      plan.regions.airport.budget.nodes * (1 - RESERVE) -
      ctx.placer.placed.length -
      3 * CAR_PARK.rows * segments;
  carPark(ctx, Math.max(0, Math.min(0.85, free / bays)));
  const tower = node(ctx, 'airport/control-tower').position,
    radar = ctx.placer.placed.find((p) => p.instance.prop === 'airport/radar-tower')!.instance
      .position;
  const characters = FIELD.runways.flatMap((t) =>
    [1, -1].flatMap((d) => [...designator(ctx, t, d).join('')]),
  );
  const output: RegionOutput = {
    props: airportProps(characters),
    instances: ctx.placer.instances,
    lights: ctx.lights,
    markers: markers(ctx),
    movers: movers(
      ctx,
      [tower[0], tower[1] + TOWER_BEACON[1], tower[2]],
      [radar[0], radar[1] + RADAR_HEIGHT, radar[2]],
    ),
    roads,
  };
  return { output, placed: ctx.placer.placed, roads: [...plan.roads, ...roads] };
}

export const airportRegion: RegionModule = {
  name: 'airport',
  refine,
  ground: GROUND,
  generate: (plan) => layout(plan).output,
};
