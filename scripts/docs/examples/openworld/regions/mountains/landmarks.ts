/**
 * The places a visitor is sent to: the lake (its far shore, the waterfall's spray, a refuge),
 * the highest summit (a cross, the viewpoint toward the city), the observatory on a lesser top,
 * and the snow plumes streaming from the highest peaks.
 */
import type { LampLight, Marker, Mover, Vec3, WorldPlan } from '../../plan/contract.ts';
import { placeLamps } from '../../props/index.ts';
import { BASEMENT } from './chalet.ts';
import type { Lake } from './lake.ts';
import { DOME_HEIGHT, OBSERVATORY_LAMPS } from './observatory.ts';
import { headingYaw } from './route.ts';
import type { Placer } from './space.ts';
import { SNOW_LINE, TREE_LINE } from './terrain.ts';
import { EYE } from '../../build/markers.ts';

export type Landmark = { lights: LampLight[]; markers: Marker[]; movers: Mover[] };

/** A viewer's eye above the ground. */

/** The teleport across the water from the outlet, the waterfall's spray, and the refuge. */
export function dressLake(placer: Placer, { id, centre, radius, spill, fall }: Lake): Marker[] {
  const away = Math.atan2(centre[0] - spill[0], centre[2] - spill[2]),
    at = (a: number, r: number) => [centre[0] + Math.sin(a) * r, centre[2] + Math.cos(a) * r],
    [x, z] = at(away, radius + 15);
  // The refuge stands back from the shore, its front to the water, as near the view as it fits.
  for (let k = 0; k < 48; k++) {
    const a = away + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.13,
      options = {
        seat: 'high',
        basement: BASEMENT,
        yaw: a + Math.PI,
        name: `mountains/${id}-refuge`,
      } as const;
    if (placer.place('mountains/refuge', ...(at(a, radius + 45) as [number, number]), options))
      break;
  }
  return [
    {
      kind: 'teleport',
      name: 'mountains/lake-shore',
      position: [x, placer.plan.height(x, z) + EYE, z],
      yaw: away + Math.PI,
      pitch: -0.05,
    },
    {
      kind: 'emitter',
      effect: 'waterfall-spray',
      name: `mountains/${id}-waterfall`,
      position: fall[fall.length - 1],
      radius: 25,
    },
  ];
}

/** The summit's cross and the viewpoint turned toward the city (or the map's centre). */
export function dressSummit(placer: Placer, plan: WorldPlan, summit: Vec3): Marker {
  const city = plan.settlements.find((s) => s.kind === 'city')?.centre ?? ([0, 0, 0] as Vec3);
  placer.place('mountains/summit-cross', summit[0] + 3, summit[2], {
    sink: 0.3,
    name: 'mountains/summit-cross',
  });
  return {
    kind: 'teleport',
    name: 'mountains/summit-viewpoint',
    position: [summit[0], summit[1] + EYE, summit[2]],
    yaw: headingYaw(city[0] - summit[0], city[2] - summit[2]),
    pitch: -0.12,
  };
}

/** The observatory on the highest top above the tree line at least 2 km from the summit. */
export function placeObservatory(placer: Placer, tops: readonly Vec3[]): Landmark {
  const summit = tops[0];
  for (const top of tops.slice(1)) {
    if (top[1] < TREE_LINE || Math.hypot(top[0] - summit[0], top[2] - summit[2]) < 2_000) continue;
    for (let k = 0; k < 40; k++) {
      const [x, z] = [top[0] + Math.cos(k) * k * 6, top[2] + Math.sin(k) * k * 6],
        base = placer.place('mountains/observatory', x, z, {
          seat: 'high',
          basement: BASEMENT,
          name: 'mountains/observatory',
        });
      if (!base) continue;
      const y = base.position[1];
      return {
        lights: placeLamps(OBSERVATORY_LAMPS, base),
        movers: [
          {
            kind: 'spin',
            name: 'mountains/observatory-dome',
            model: 'mountains/observatory-dome',
            position: [x, y + DOME_HEIGHT, z],
            axis: [0, 1, 0],
            rpm: 0.2,
          },
        ],
        markers: [
          {
            kind: 'teleport',
            name: 'mountains/observatory',
            position: [x + 25, placer.plan.height(x + 25, z) + EYE, z],
            yaw: -Math.PI / 2,
          },
        ],
      };
    }
  }
  return { lights: [], movers: [], markers: [] };
}

/** Snow blowing off the five highest summits near or above the snow line. */
export const snowPlumes = (tops: readonly Vec3[]): Marker[] =>
  tops
    .filter((t) => t[1] > SNOW_LINE - 200)
    .slice(0, 5)
    .map((top, k) => ({
      kind: 'emitter',
      effect: 'snow-plume',
      name: `mountains/snow-plume-${k}`,
      position: [top[0], top[1] + 20, top[2]],
      radius: 150,
    }));
