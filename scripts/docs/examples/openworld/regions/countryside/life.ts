/**
 * The region's life: tractors driving the farm tracks, and the emitters the page turns into
 * effects — birds circling over the farms, fireflies by the rivers and the lake, dust on the tracks.
 */
import type { Marker, Mover, Vec3 } from '../../plan/contract.ts';
import type { Farm } from './farms.ts';
import type { Site } from './site.ts';

/** Tractors up and down the first farm tracks, dust on every track, birds over the farms. */
export function farmLife(farms: readonly Farm[]): { markers: Marker[]; movers: Mover[] } {
  const markers: Marker[] = [],
    movers: Mover[] = [];
  farms.forEach((farm, i) => {
    if (i % 3 === 0)
      markers.push({
        kind: 'emitter',
        effect: 'birds',
        name: `countryside/farm-${i}/birds`,
        position: [farm.centre[0], farm.centre[1] + 45, farm.centre[2]],
        radius: 180,
      });
    const track = farm.track;
    if (!track) return;
    const middle = track.points[Math.floor(track.points.length / 2)],
      [a, b] = [track.points[0], track.points[track.points.length - 1]];
    markers.push({
      kind: 'emitter',
      effect: 'road-dust',
      name: `${track.id}/dust`,
      position: middle,
      radius: Math.hypot(a[0] - b[0], a[2] - b[2]) / 2,
    });
    if (movers.length < 8)
      movers.push({
        kind: 'path',
        name: `${track.id}/tractor`,
        model: 'countryside/tractor',
        points: [...track.points, ...[...track.points].reverse().slice(1)],
        speed: 3.5,
        loop: true,
      });
  });
  return { markers, movers };
}

/** Fireflies along the rivers inside the bounds (one swarm every 1.5 km) and at each lake. */
export function fireflies(site: Site): Marker[] {
  const out: Marker[] = [],
    b = site.bounds,
    inside = ([x, , z]: Vec3) => x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ;
  for (const river of site.plan.rivers) {
    let run = 0;
    river.points.forEach((p, i) => {
      if (i) run += Math.hypot(p[0] - river.points[i - 1][0], p[2] - river.points[i - 1][2]);
      if (run < 1_500 || !inside(p)) return;
      run = 0;
      out.push({
        kind: 'emitter',
        effect: 'fireflies',
        name: `countryside/${river.id}/fireflies-${out.length}`,
        position: [p[0], p[1] + 1, p[2]],
        radius: 80,
      });
    });
  }
  for (const lake of site.lakes)
    out.push({
      kind: 'emitter',
      effect: 'fireflies',
      name: `countryside/${lake.id}/fireflies`,
      position: [lake.x, lake.level + 1, lake.z],
      radius: lake.radius + 40,
    });
  return out;
}
