/**
 * The highway's roadside: a filling station and a truck stop on one side, a high-voltage line
 * on the other, billboards between. Sites are searched along the plan's highway where it
 * crosses the region, from its middle outward, until the ground takes the buildings.
 */
import type { Bounds, Road, Vec3 } from '../../plan/contract.ts';
import {
  along,
  facing,
  lengthOf,
  offset,
  placeLit,
  teleport,
  type Build,
  type Station,
} from './build.ts';
import { cableSpan, lineYaw } from './powerline.ts';

/** The longest run of a road's points inside `bounds` (inset by `margin`). */
function insideRun(road: Road, { minX, minZ, maxX, maxZ }: Bounds, margin: number): Vec3[] {
  let best: Vec3[] = [],
    run: Vec3[] = [];
  for (const p of [...road.points, undefined]) {
    if (
      p &&
      p[0] > minX + margin &&
      p[0] < maxX - margin &&
      p[2] > minZ + margin &&
      p[2] < maxZ - margin
    ) {
      run.push(p);
      continue;
    }
    if (lengthOf(run) > lengthOf(best)) best = run;
    run = [];
  }
  return best;
}

/** The plan's highways through the region, the longest run inside it first. */
function highways(b: Build) {
  const runs = b.plan.roads
    .filter((r) => r.class === 'highway')
    .map((road) => ({ road, run: insideRun(road, b.site.bounds, 150) }))
    .filter(({ run }) => run.length > 1);
  return runs.sort((p, q) => lengthOf(q.run) - lengthOf(p.run));
}

/** Stations along `run` from `start` (a share of its length) outward, both sides. */
function* candidates(run: readonly Vec3[], start: number) {
  const length = lengthOf(run);
  for (let k = 0; k < 180; k++) {
    const share = start + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.005;
    if (share < 0.05 || share > 0.95) continue;
    for (const side of [1, -1]) yield { s: along(run, share * length), side };
  }
}

/** The yaw that turns a roadside building's front toward the road from `side`. */
const faceRoad = (s: Station, side: number) => facing(side * s.tz, -side * s.tx);
/** The yaw that runs a node's +X along the road. */
const alongRoad = (s: Station) => Math.atan2(-s.tz, s.tx);

/** The filling station: forecourt, shop, price sign, lamps, a car spawn and a teleport. */
function fillingStation(b: Build, road: Road, run: readonly Vec3[]) {
  // Beside the road first; on steep ground the forecourt steps back to the nearest flat.
  for (const gap of [0, 30, 60, 120, 240]) {
    const side = stationAt(b, road.width / 2 + gap, run);
    if (side) return side;
  }
  return 0;
}

function stationAt(b: Build, hw: number, run: readonly Vec3[]) {
  for (const { s, side } of candidates(run, 0.5)) {
    const yaw = faceRoad(s, side),
      [fx, fz] = offset(s, side * (hw + 16));
    const slab = placeLit(b, 'desert/forecourt', fx, fz, yaw, { name: 'desert/station/forecourt' });
    if (!slab) continue;
    placeLit(b, 'desert/station-shop', ...offset(s, side * (hw + 38)), yaw, {
      name: 'desert/station/shop',
    });
    placeLit(b, 'desert/price-sign', ...offset(s, side * (hw + 3), -22), yaw, {
      name: 'desert/station/sign',
    });
    for (const ahead of [-19, 19])
      placeLit(b, 'street-lamp', ...offset(s, side * (hw + 2.5), ahead), yaw - Math.PI / 2);
    const [cx, cz] = offset(s, side * (hw + 7), 8);
    b.markers.push({
      kind: 'spawn',
      vehicle: 'car',
      name: 'desert/station/car',
      position: [cx, slab.position[1] + 0.3, cz],
      yaw: facing(s.tx, s.tz),
    });
    const [vx, vz] = offset(s, side * (hw + 4), -40);
    teleport(b, 'desert/gas-station', vx, vz, [fx, fz], -0.05);
    return side;
  }
  return 0;
}

/** The truck stop: a high canopy, a diner, lorries parked in a row, dust where they turn. */
function truckStop(b: Build, road: Road, run: readonly Vec3[], side: number) {
  const hw = road.width / 2;
  for (const c of candidates(run, 0.78)) {
    if (side && c.side !== side) continue;
    const { s } = c,
      yaw = faceRoad(s, c.side);
    if (
      !placeLit(b, 'desert/truck-canopy', ...offset(s, c.side * (hw + 16)), yaw, {
        name: 'desert/truck-stop/canopy',
      })
    )
      continue;
    placeLit(b, 'desert/diner', ...offset(s, c.side * (hw + 44), -16), yaw, {
      name: 'desert/truck-stop/diner',
    });
    for (let i = 0; i < 5; i++)
      b.site.place(
        i % 2 ? 'desert/lorry-red' : 'desert/lorry-blue',
        ...offset(s, c.side * (hw + 36 + i * 4.6), 18),
        alongRoad(s),
      );
    for (const ahead of [-24, 24, 44])
      placeLit(b, 'street-lamp', ...offset(s, c.side * (hw + 2.5), ahead), yaw - Math.PI / 2);
    const [dx, dz] = offset(s, c.side * (hw + 30));
    b.markers.push({
      kind: 'emitter',
      effect: 'road-dust',
      name: 'desert/truck-stop/dust',
      position: [dx, b.plan.height(dx, dz), dz],
      radius: 60,
    });
    return;
  }
}

/** Pylon spacing, metres: 300–400 m spans are usual for this tower height. */
const SPAN = 350;

/** A high-voltage line along the highway, `side` of it, conductors hung between pylons. */
function powerLine(b: Build, road: Road, run: readonly Vec3[], side: number) {
  const hw = road.width / 2,
    length = lengthOf(run);
  let last: ReturnType<typeof b.site.place>;
  for (let d = SPAN / 2, k = 0; d < length; d += SPAN, k++) {
    const s = along(run, d),
      yaw = lineYaw(s.tx, s.tz);
    let pylon: typeof last;
    for (const shift of [0, 30, -30, 60, -60]) {
      const at = offset(s, side * (hw + 35), shift);
      pylon = b.site.place('power-pylon', ...at, yaw, { name: `desert/line/pylon-${k}` });
      if (pylon) break;
    }
    if (
      pylon &&
      last &&
      Math.hypot(pylon.position[0] - last.position[0], pylon.position[2] - last.position[2]) <
        SPAN * 1.4
    ) {
      const span = cableSpan(`desert/line/span-${k}`, last, pylon);
      b.props.push(span);
      b.site.instances.push({ prop: span.id, position: last.position, yaw: 0, name: span.id });
    }
    last = pylon;
  }
}

/** Billboards facing the traffic, a heat-haze emitter over the asphalt. */
function billboards(b: Build, road: Road, run: readonly Vec3[], side: number) {
  const length = lengthOf(run);
  for (const share of [0.3, 0.65]) {
    const s = along(run, share * length);
    b.site.place('desert/billboard', ...offset(s, side * (road.width / 2 + 14)), faceRoad(s, side));
    b.markers.push({
      kind: 'emitter',
      effect: 'heat-haze',
      name: `desert/highway/haze-${share}`,
      position: [s.x, s.y, s.z],
      radius: 900,
    });
  }
}

/** Everything along the highway; returns it (and the station's side) for the town's link road. */
export function roadside(b: Build) {
  const all = highways(b),
    main = all[0];
  if (!main) return undefined;
  // The station takes the first highway with a roadside flat enough for its forecourt.
  let side = 0;
  for (const { road, run } of all) if ((side = fillingStation(b, road, run))) break;
  truckStop(b, main.road, main.run, side);
  powerLine(b, main.road, main.run, side ? -side : 1);
  billboards(b, main.road, main.run, side || 1);
  return main;
}
