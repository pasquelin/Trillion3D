/**
 * The airport's own frame. Everything is laid out in (s, t): `s` along the runways, `t` across
 * them, airside at negative `t`, landside at positive `t`. The field lies on the plan's levelled
 * platform (else the region's bounds): runways along its long side, centred on it, the landside
 * slid to the edge facing the nearest arterial road, so the access road stays short.
 */
import type { Bounds, WorldPlan } from '../../plan/contract.ts';
import { isTerrainPlan } from '../../plan/plan.ts';

/** Real dimensions, metres (ICAO code 4E runway and taxiway widths). */
export const FIELD = {
  runwayLength: 2400,
  runwayWidth: 45,
  taxiwayWidth: 23,
  /** Runway centrelines across the field; the parallel taxiway runs between them. */
  runways: [-900, -450],
  parallelTaxiway: -675,
  apronTaxiway: -270,
  /** Airside face of the terminal; the apron lies between it and the apron taxiway. */
  terminalFace: -60,
  curbside: 15,
  /** How far the approach lights, localizers and fence reach past each runway end. */
  overrun: 450,
  across: [-1000, 330],
  /** Kept clear between the fence and the region's edge. */
  margin: 200,
} as const;

export type Site = {
  bounds: Bounds;
  /** Runway length, 2.4 km unless the region is too short for it. */
  length: number;
  /** Unit vectors of `s` and `t` in world (x, z). */
  u: readonly [number, number];
  v: readonly [number, number];
  /** World (x, z) of local (s, t). */
  world(s: number, t: number): [number, number];
  /** Local (s, t) of world (x, z). */
  local(x: number, z: number): [number, number];
  /** An instance's yaw that turns a prop's +Z toward local direction (ds, dt). */
  yaw(ds: number, dt: number): number;
  /** A marker's yaw facing local direction (ds, dt): radians about +Y, 0 facing north (−Z). */
  facing(ds: number, dt: number): number;
  /** Compass bearing, degrees, of local direction (ds, dt): north is −Z, east +X. */
  bearing(ds: number, dt: number): number;
};

/** The ground the field may use: the plan's levelled platform when it has one, else the bounds. */
function areaOf(plan: WorldPlan): { area: Bounds; margin: number } {
  const platform = isTerrainPlan(plan) ? plan.platform : undefined;
  return platform
    ? { area: platform, margin: 0 }
    : { area: plan.regions.airport.bounds, margin: FIELD.margin };
}

/** The arterial road point nearest to (x, z): where the landside should face. */
function nearestArterial(plan: WorldPlan, x: number, z: number) {
  let best: readonly [number, number] | undefined,
    distance = Infinity;
  for (const road of plan.roads)
    if (road.class === 'highway' || road.class === 'secondary')
      for (const [px, , pz] of road.points) {
        const d = Math.hypot(px - x, pz - z);
        if (d < distance) [best, distance] = [[px, pz], d];
      }
  return best;
}

export function siteOf(plan: WorldPlan): Site {
  const { bounds } = plan.regions.airport,
    { area, margin } = areaOf(plan);
  const alongX = area.maxX - area.minX >= area.maxZ - area.minZ,
    ax = (area.minX + area.maxX) / 2,
    az = (area.minZ + area.maxZ) / 2;
  const u: [number, number] = alongX ? [1, 0] : [0, 1],
    road = nearestArterial(plan, ax, az),
    side = road && (road[0] - ax) * -u[1] + (road[1] - az) * u[0] < 0 ? -1 : 1,
    v: [number, number] = [-u[1] * side, u[0] * side];
  const spanS = alongX ? area.maxX - area.minX : area.maxZ - area.minZ,
    spanT = alongX ? area.maxZ - area.minZ : area.maxX - area.minX,
    [t0, t1] = FIELD.across;
  const length = Math.min(FIELD.runwayLength, spanS - 2 * (FIELD.overrun + margin));
  if (length < 1800 || spanT < t1 - t0 + 2 * margin)
    throw new Error(`airport: ${spanS} × ${spanT} m is too small for a field`);
  // Centred along the runways; across them, slid to the area's edge on the landside, where
  // the arterial road arrives.
  const mid = (t0 + t1) / 2,
    slide = (spanT - (t1 - t0)) / 2 - margin,
    cx = ax + v[0] * slide,
    cz = az + v[1] * slide;
  const world = (s: number, t: number): [number, number] => [
    cx + s * u[0] + (t - mid) * v[0],
    cz + s * u[1] + (t - mid) * v[1],
  ];
  const toWorld = (ds: number, dt: number) => [ds * u[0] + dt * v[0], ds * u[1] + dt * v[1]];
  return {
    bounds,
    length,
    u,
    v,
    world,
    local: (x, z) => [(x - cx) * u[0] + (z - cz) * u[1], (x - cx) * v[0] + (z - cz) * v[1] + mid],
    yaw: (ds, dt) => {
      const [dx, dz] = toWorld(ds, dt);
      return Math.atan2(dx, dz);
    },
    facing: (ds, dt) => {
      const [dx, dz] = toWorld(ds, dt);
      return Math.atan2(-dx, -dz);
    },
    bearing: (ds, dt) => {
      const [dx, dz] = toWorld(ds, dt);
      return ((Math.atan2(dx, -dz) * 180) / Math.PI + 360) % 360;
    },
  };
}
