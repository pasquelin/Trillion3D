/**
 * The road network (#332): a highway ring through every region, secondaries from each village to
 * the nearest road, the mountain pass to the ski resort, the city's avenue grid, the airport
 * access, and dirt trails for walkers between villages, viewpoints, lakes and beaches.
 */
import type { Bridge, RoadClass, Settlement, Vec3 } from './contract.ts';
import type { Lake, Platform, RoadCourse } from './carve.ts';
import { REGION_BOUNDS } from './layout.ts';
import type { Point2 } from './polyline.ts';
import type { Tunnel } from './tunnels.ts';
import { layRoad, buildRoad, riverIndex, ROAD_STEP, type Ground } from './roads.ts';
import { node, STEP } from './route.ts';
import { around, best, slopeAt } from './sites.ts';

/** Avenue spacing in the city, metres: a block of avenues the city region fills with streets. */
const AVENUE = 500;

export type Network = {
  courses: RoadCourse[];
  bridges: Bridge[];
  tunnels: Tunnel[];
  viewpoints: Vec3[];
};

export function planNetwork(
  ground: Ground,
  settlements: readonly Settlement[],
  lakes: readonly Lake[],
  platform: Platform,
): Network {
  const overRiver = riverIndex(ground.rivers),
    courses: RoadCourse[] = [],
    bridges: Bridge[] = [],
    tunnels: Tunnel[] = [],
    viewpoints: Vec3[] = [],
    onNetwork = new Set<number>(),
    find = (id: string) => settlements.find((s) => s.id === id),
    xz = (s: Settlement | Vec3): Point2 =>
      'centre' in s ? [s.centre[0], s.centre[2]] : [s[0], s[2]];
  const keep = (built: ReturnType<typeof layRoad> | null, joinsNetwork = true) => {
    if (!built) return;
    courses.push(built.course);
    bridges.push(...built.bridges);
    tunnels.push(...built.tunnels);
    if (joinsNetwork) for (const [x, , z] of built.course.road.points) onNetwork.add(node(x, z));
  };
  const road = (id: string, cls: RoadClass, from: Point2, to: Point2 | 'network', joins = true) =>
    keep(
      buildRoad(
        id,
        cls,
        from,
        to === 'network' ? (index) => onNetwork.has(index) : to,
        ground,
        overRiver,
      ),
      joins,
    );

  // The airport interchange sits south of the platform, facing the city.
  const centreX = (platform.minX + platform.maxX) / 2,
    interchange: Point2 = [centreX, platform.maxZ + 300];
  const ring: Point2[] = [
    find('city'),
    interchange,
    find('coast-town'),
    find('countryside-town'),
    find('mountains-town'),
    find('desert-town'),
  ].flatMap((stop) =>
    !stop ? [] : Array.isArray(stop) ? [stop as Point2] : [xz(stop as Settlement)],
  );
  ring.forEach((stop, index) =>
    road(`highway-${index}`, 'highway', stop, ring[(index + 1) % ring.length]),
  );
  road('airport-access', 'secondary', interchange, [centreX, platform.maxZ - 300]);
  const resort = find('ski-resort'),
    mountainTown = find('mountains-town');
  if (resort && mountainTown) road('pass', 'pass', xz(mountainTown), xz(resort));
  for (const s of settlements)
    if (s.kind === 'village' || (s.kind === 'port' && s.region === 'city'))
      road(`${s.id}/road`, 'secondary', xz(s), 'network');

  const city = find('city');
  if (city)
    avenues(city, ground, (id, path) => keep(layRoad(id, 'avenue', path, ground, overRiver)));

  // Trails: every village to its two nearest villages, to a viewpoint, lakes and beaches.
  const villages = settlements.filter((s) => s.kind === 'village' || s.kind === 'resort'),
    linked = new Set<string>();
  for (const v of villages) {
    const nearest = villages
      .filter((o) => o !== v)
      .sort((a, b) => dist(a.centre, v.centre) - dist(b.centre, v.centre))
      .slice(0, 2);
    for (const o of nearest) {
      const key = [v.id, o.id].sort().join('+');
      if (linked.has(key) || dist(o.centre, v.centre) > 8_000) continue;
      linked.add(key);
      road(`trail/${key}`, 'dirt', xz(v), xz(o), false);
    }
    // A viewpoint: the highest ground within 3 km that a walker can still stand on.
    const view = best(ground.grid, around(v.centre[0], v.centre[2], 3_000), (x, z, h) =>
      slopeAt(ground.grid, x, z) < 0.5 && !ground.wet(x, z) ? h : -Infinity,
    );
    if (view && view[1] > v.centre[1] + 50) {
      viewpoints.push(view);
      road(`trail/${v.id}/viewpoint`, 'dirt', xz(v), xz(view), false);
    }
    const beach = best(ground.grid, around(v.centre[0], v.centre[2], 3_000), (x, z, h) =>
      h > 0.5 &&
      h < 3 &&
      [
        [STEP, 0],
        [-STEP, 0],
        [0, STEP],
        [0, -STEP],
      ].some(([dx, dz]) => ground.grid.at(x + dx, z + dz) < 0)
        ? -Math.hypot(x - v.centre[0], z - v.centre[2])
        : -Infinity,
    );
    if (beach) road(`trail/${v.id}/beach`, 'dirt', xz(v), xz(beach), false);
  }
  for (const lake of lakes) {
    const village = [...villages].sort(
        (a, b) => dist(a.centre, [lake.x, 0, lake.z]) - dist(b.centre, [lake.x, 0, lake.z]),
      )[0],
      shore: Point2 = [lake.x + lake.radius + ROAD_STEP, lake.z];
    if (village) road(`trail/${lake.id}`, 'dirt', xz(village), shore, false);
  }
  return { courses, bridges, tunnels, viewpoints };
}

const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[2] - b[2]);

/**
 * The city's avenues: a grid of straight lines through its footprint, cut where they meet the sea
 * or leave the city's rectangle.
 */
function avenues(city: Settlement, ground: Ground, lay: (id: string, path: Point2[]) => void) {
  const b = REGION_BOUNDS.city,
    inside = (x: number, z: number) => x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ,
    [cx, , cz] = city.centre,
    r = city.radius,
    lines = Math.floor(r / AVENUE);
  for (const axis of [0, 1])
    for (let k = -lines; k <= lines; k++) {
      let run: Point2[] = [],
        part = 0;
      const flush = () => {
        if (run.length * ROAD_STEP >= AVENUE) lay(`avenue-${axis ? 'z' : 'x'}${k}-${part++}`, run);
        run = [];
      };
      const half = Math.sqrt(Math.max(0, r * r - (k * AVENUE) ** 2));
      for (let s = -half; s <= half; s += ROAD_STEP) {
        const [x, z] = axis ? [cx + s, cz + k * AVENUE] : [cx + k * AVENUE, cz + s];
        if (ground.wet(x, z) || !inside(x, z)) flush();
        else run.push([x, z]);
      }
      flush();
    }
}
