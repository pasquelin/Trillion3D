/**
 * Farms: a yard of buildings (farmhouse, gambrel barn, silos, a parked tractor, hay bales), a dirt
 * track to the nearest road of the plan, and a ring of fields round the yard — crops, pasture, now
 * and then an orchard — hedged and walled along their edges.
 */
import type { Road, Vec3 } from '../../plan/contract.ts';
import { hash01 } from '../../props/index.ts';
import type { Rect } from './footprint.ts';
import { fieldEdges, CROPS, type Field } from './fields.ts';
import { frame, nearestRoad, scatter, type Land } from './land.ts';
import type { Site } from './site.ts';

/** Distance between farms, metres: a farm works about a square kilometre and a half. */
const FARM_SPACING = 1_250;
/** Longest dirt track a farm lays to reach a road, metres. */
const TRACK_REACH = 2_500;
/** One field slot: pitch along the farm's X and Z, and the lane left between two fields. */
const SLOT = { x: 170, z: 130, lane: 9 };
/** Share of field slots planted as orchards. */
const ORCHARD = 0.05;
/** The yard's buildings in the farm's frame: prop, x, z, yaw. */
const YARD: readonly (readonly [string, number, number, number])[] = [
  ['countryside/farmhouse', -18, -14, 0],
  ['countryside/barn', 16, -18, 0],
  ['countryside/silo', 32, -6, 0],
  ['countryside/silo', 32, 3, 0],
  ['countryside/tractor', -2, 8, 0.6],
  ['countryside/hay-bales', 20, 8, 0.2],
];

export type Farm = { centre: Vec3; yaw: number; track?: Road; fields: Field[] };

/** A straight dirt track sampled every 20 m, if its whole course is free ground. */
function track(site: Site, id: string, from: [number, number], to: Vec3): Road | undefined {
  const length = Math.hypot(to[0] - from[0], to[2] - from[1]),
    steps = Math.max(1, Math.ceil(length / 20)),
    yaw = Math.atan2(to[0] - from[0], to[2] - from[1]),
    points: Vec3[] = [];
  for (let k = 0; k <= steps; k++) {
    const x = from[0] + ((to[0] - from[0]) * k) / steps,
      z = from[1] + ((to[2] - from[1]) * k) / steps;
    points.push([x, k === steps ? to[1] : site.plan.height(x, z), z]);
    if (k === 0) continue;
    const [px, , pz] = points[k - 1],
      rect: Rect = { x: (x + px) / 2, z: (z + pz) / 2, hx: 1.75, hz: length / steps / 2, yaw };
    if (!site.free(rect, { onRoad: true }) || points[k][1] < 1) return undefined;
  }
  return { id, class: 'dirt', width: 3.5, points };
}

export function placeFarms(site: Site, land: Land, seed: number): Farm[] {
  const farms: Farm[] = [];
  for (const [x, z] of scatter(site.plan, FARM_SPACING, seed)) {
    if (land.forest(x, z) > -0.08) continue;
    const yaw = hash01(seed + 2, Math.round(x), Math.round(z)) * Math.PI * 2,
      local = frame(x, z, yaw),
      id = `farm-${farms.length}`;
    const [fx, fz] = local.at(...([YARD[0][1], YARD[0][2]] as const));
    if (
      !site.place(YARD[0][0], fx, fz, local.yaw(YARD[0][3]), {
        seat: 'plinth',
        name: `countryside/${id}/farmhouse`,
      })
    )
      continue;
    YARD.slice(1).forEach(([prop, a, b, turn], k) =>
      site.place(prop, ...local.at(a, b), local.yaw(turn), {
        seat: prop.includes('tractor') || prop.includes('hay') ? 'mean' : 'plinth',
        name: `countryside/${id}/${prop.slice(prop.indexOf('/') + 1)}-${k}`,
      }),
    );
    const gate = local.at(0, 40),
      road = nearestRoad(site.plan, gate[0], gate[1]),
      lane =
        road && road.distance < TRACK_REACH
          ? track(site, `countryside/${id}/track`, gate, road.point)
          : undefined;
    if (lane) site.addRoad(lane);
    const fields: Field[] = [];
    for (let i = -1; i <= 1; i++)
      for (let j = -1; j <= 1; j++) {
        if (!i && !j) continue;
        const [cx, cz] = local.at(i * SLOT.x, j * SLOT.z),
          rect: Rect = {
            x: cx,
            z: cz,
            hx: (SLOT.x - SLOT.lane) / 2,
            hz: (SLOT.z - SLOT.lane) / 2,
            yaw,
          },
          pick = hash01(seed + 5, farms.length, i * 3 + j);
        if (pick < ORCHARD) placeOrchard(site, rect);
        else {
          if (!site.free(rect)) continue;
          site.take(rect);
          fields.push({
            id: `${id}-${fields.length}`,
            rect,
            crop: Math.floor(hash01(seed + 6, farms.length, i * 3 + j) * CROPS.length),
          });
        }
        fieldEdges(site, rect, seed + farms.length * 16 + (i + 1) * 3 + j + 1);
      }
    farms.push({
      centre: [x, site.plan.height(x, z), z],
      yaw,
      ...(lane ? { track: lane } : {}),
      fields,
    });
  }
  return farms;
}

/** An orchard in a field's rectangle: fruit trees in rows 8 m apart. */
function placeOrchard(site: Site, rect: Rect) {
  const local = frame(rect.x, rect.z, rect.yaw),
    rows = Math.floor((2 * rect.hz) / 8),
    columns = Math.floor((2 * rect.hx) / 8);
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < columns; c++)
      site.place(
        'countryside/fruit-tree',
        ...local.at(-rect.hx + 4 + c * 8, -rect.hz + 4 + r * 8),
        rect.yaw + r + c,
      );
}
