/**
 * Where a road is bored through a ridge rather than cut open (#332). A road point lies under
 * cover when the ground on both sides, a little beyond its shoulders, stands more than `COVER`
 * metres above its surface; a covered run at least `MIN_RUN` long whose ground over the road
 * itself stands more than `CROWN` metres (by its median) is a tunnel. The plan leaves the ground
 * over a tunnel alone, and a region puts a portal at each of its ends. A covered run with an
 * open crown is a cutting, levelled like any road.
 */
import type { Road, Vec3 } from './contract.ts';

/** Ground over both sides of a tunnel's run, and over its crown, metres. */
export const COVER = 25;
export const CROWN = 6;
/** The shortest bore worth a tunnel, metres; shorter covered runs are cut open. */
export const MIN_RUN = 60;
/** How far beside the shoulders the sides are read, metres. */
const SIDE = 20;

export type Tunnel = { id: string; road: string; from: Vec3; to: Vec3; width: number };

/** The tunnels of a road over `ground`, and per segment whether it runs inside one. */
export function boreTunnels(
  road: Road,
  ground: (x: number, z: number) => number,
  bridge: readonly boolean[],
): { tunnel: boolean[]; tunnels: Tunnel[] } {
  const points = road.points,
    tunnel = points.slice(1).map(() => false),
    tunnels: Tunnel[] = [];
  const covered = points.map((p, k) => {
    if (bridge[k] || bridge[k - 1]) return false;
    const [a, b] = [points[Math.max(0, k - 1)], points[Math.min(points.length - 1, k + 1)]],
      length = Math.hypot(b[0] - a[0], b[2] - a[2]) || 1,
      [nx, nz] = [-(b[2] - a[2]) / length, (b[0] - a[0]) / length],
      reach = road.width / 2 + SIDE;
    return [1, -1].every(
      (side) => ground(p[0] + nx * reach * side, p[2] + nz * reach * side) - p[1] > COVER,
    );
  });
  for (let first = 0; first < points.length; first++) {
    if (!covered[first]) continue;
    let last = first;
    while (last + 1 < points.length && covered[last + 1]) last++;
    let run = 0;
    for (let k = first; k < last; k++)
      run += Math.hypot(points[k + 1][0] - points[k][0], points[k + 1][2] - points[k][2]);
    const crown = points
      .slice(first, last + 1)
      .map((p) => ground(p[0], p[2]) - p[1])
      .sort((a, b) => a - b)[(last - first) >> 1];
    if (run >= MIN_RUN && crown > CROWN) {
      for (let k = first; k < last; k++) tunnel[k] = true;
      tunnels.push({
        id: `${road.id}/tunnel-${tunnels.length}`,
        road: road.id,
        from: points[first],
        to: points[last],
        width: road.width,
      });
    }
    first = last;
  }
  return { tunnel, tunnels };
}
