/**
 * The lighthouse stands on the mainland's most prominent cliff: the high shore with the most sea
 * around it, a headland. It sits back from the edge on the first flat enough ground, faces the
 * sea, sweeps its beam (a `beacon` mover and a `lighthouse-beam` emitter), and is reached by a
 * track from the nearest road of the plan.
 */
import type { Vec3 } from '../../../plan/contract.ts';
import { LIGHTHOUSE } from '../props/lighthouse.ts';
import { CLIFF_MIN } from './cliffs.ts';
import { yawToward, type Layout } from './layout.ts';
import { seaAround, type Shore } from './map.ts';

export type Headland = { foot: Vec3; lamp: Vec3; normal: readonly [number, number] };

/** A beam turning 4 times a minute: one flash every 15 s, a common major-light period. */
const BEAM_RPM = 4;

export function raiseLighthouse(layout: Layout): Headland | undefined {
  const high = layout.map.shores.filter((s) => !s.island && s.height >= CLIFF_MIN),
    pool = high.length ? high : layout.map.shores.filter((s) => !s.island);
  const ranked = pool
    .map((s) => ({ s, sea: seaAround(layout.map, s.x, s.z, 800) }))
    .sort((a, b) => b.sea - a.sea || a.s.cell - b.s.cell);
  for (const { s } of ranked.slice(0, 20)) {
    const n = s.normal,
      yaw = yawToward(n[0], n[1]);
    for (let d = 30; d <= 200; d += 10) {
      const [x, z] = [s.x - n[0] * d, s.z - n[1] * d],
        placed = layout.place('coast-lighthouse', x, z, yaw, {
          maxRise: 1.5,
          name: 'coast/lighthouse',
        });
      if (!placed) continue;
      layout.instances.push({ ...placed, prop: 'coast-lighthouse-lantern', name: 'coast/lantern' });
      const foot = placed.position,
        lamp: Vec3 = [x, foot[1] + LIGHTHOUSE.lamp, z];
      layout.movers.push({
        kind: 'beacon',
        name: 'coast/lighthouse-beam',
        position: lamp,
        rpm: BEAM_RPM,
        range: 20_000,
      });
      layout.markers.push(
        {
          kind: 'emitter',
          effect: 'lighthouse-beam',
          name: 'coast/lighthouse-beam',
          position: lamp,
          radius: 20_000,
        },
        {
          kind: 'emitter',
          effect: 'birds',
          name: 'coast/gulls-headland',
          position: [x + n[0] * 80, foot[1] + 30, z + n[1] * 80],
          radius: 200,
        },
      );
      trackTo(layout, s, [x - n[0] * 18, foot[1], z - n[1] * 18]);
      return { foot, lamp, normal: n };
    }
  }
  return undefined;
}

/** A dirt track from `start` straight to the nearest plan road point within 3 km, over land. */
function trackTo(layout: Layout, s: Shore, start: Vec3) {
  const b = layout.map.bounds;
  let best: Vec3 | undefined,
    distance = 3_000;
  for (const road of layout.map.plan.roads)
    for (const p of road.points) {
      const d = Math.hypot(p[0] - start[0], p[2] - start[2]);
      if (p[0] < b.minX || p[0] > b.maxX || p[2] < b.minZ || p[2] > b.maxZ) continue;
      if (d < distance) [best, distance] = [p, d];
    }
  if (!best) return;
  const steps = Math.max(2, Math.ceil(distance / 20)),
    points: Vec3[] = [];
  for (let i = 0; i <= steps; i++) {
    const x = start[0] + ((best[0] - start[0]) * i) / steps,
      z = start[2] + ((best[2] - start[2]) * i) / steps,
      h = layout.map.height(x, z);
    if (h <= 0.5) return;
    points.push([x, h, z]);
  }
  layout.addRoad({ id: `coast/lighthouse-track-${s.cell}`, class: 'dirt', width: 4, points });
}
