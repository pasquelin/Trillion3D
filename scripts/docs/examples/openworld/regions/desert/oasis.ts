/**
 * The oasis settlements: a raised pool under palms at the heart, a ring street, four streets
 * out, mud-brick houses facing inward, wells and lanterns, palm gardens around. The town adds a
 * domed hall, a market square and a dirt track to the highway; villages are the same, smaller.
 * Around the houses, the palm gardens: groves of date palms (`props/stands.ts`) on every square
 * of the patch grid the ring holds.
 * Each stands on the flattest ground near its plan settlement's centre.
 */
import type { Settlement, Vec3 } from '../../plan/contract.ts';
import { between, hash01, STAND_SIDE } from '../../props/index.ts';
import { facing, placeLit, teleport, type Build } from './build.ts';
import { GROVE } from './catalog.ts';
import type { Point } from './geometry2.ts';
import { corners } from './site.ts';
import { flattest, nearest, street } from './streets.ts';

/** Ring street radius and street widths, metres: a lane each way in town, a wide track out. */
const RING = 58,
  STREET = 6,
  TRACK = 7;

/** Width of the ring of palm gardens beyond the houses, metres. */
const GARDENS = 180;

type Plan = { edge: number; palms: number; lanterns: number; civic: boolean };
const TOWN: Plan = { edge: 260, palms: 60, lanterns: 20, civic: true };
const VILLAGE: Plan = { edge: 140, palms: 30, lanterns: 10, civic: false };

const HOUSES = [
  'desert/house-small',
  'desert/house-long',
  'desert/house-tall',
  'desert/house-tower',
  'desert/house-white',
  'desert/house-wide',
];

/** One settlement; the town (`civic`) also joins `highway` by a dirt track. */
export function oasis(b: Build, home: Settlement, highway?: readonly Vec3[]) {
  const layout = home.kind === 'town' ? TOWN : VILLAGE,
    { edge } = layout,
    name = `desert/${home.id}`,
    seed = b.plan.subSeed(name),
    [cx, cz] = heart(
      b,
      name,
      flattest(b, [home.centre[0], home.centre[2]], home.radius / 2, edge + 60),
    ),
    polar = (r: number, a: number): Point => [cx + r * Math.cos(a), cz + r * Math.sin(a)],
    join = layout.civic && highway ? nearest(highway, [cx, cz], 8000) : undefined,
    toward = join ? Math.atan2(join[1] - cz, join[0] - cx) : hash01(seed, 7) * Math.PI * 2;
  for (let i = 0; i < layout.palms; i++) {
    const a = between(seed, i, 0, Math.PI * 2),
      palm = i % 3 ? 'tree-palm-large' : 'tree-palm-small';
    b.site.place(palm, ...polar(between(seed + 1, i, 22, RING - 5), a), a * 3);
    b.site.place('desert/reeds', ...polar(between(seed + 2, i, 17, 21), a + 0.05), a);
  }
  const ring = Array.from({ length: 41 }, (_, i) => polar(RING, toward + (i / 40) * Math.PI * 2));
  street(b, `${name}/ring`, 'street', STREET, ring);
  for (let k = 0; k < 4; k++) {
    const a = toward + (k * Math.PI) / 2;
    street(b, `${name}/street-${k}`, 'street', STREET, [polar(RING, a), polar(edge, a)]);
  }
  if (join) track(b, name, polar(edge, toward), join);
  const hall = layout.civic ? civic(b, name, [cx, cz], polar, toward) : undefined;
  // Lanterns along the ring, their brackets over the street.
  for (let i = 0; i < layout.lanterns; i++) {
    const a = toward + ((i + 0.5) / layout.lanterns) * Math.PI * 2;
    placeLit(
      b,
      'desert/lantern-post',
      ...polar(RING + 4.5, a),
      Math.atan2(Math.sin(a), -Math.cos(a)),
    );
  }
  houses(b, seed, [cx, cz], edge, polar);
  groves(b, seed, [cx, cz], edge);
  if (hall) teleport(b, 'desert/oasis', ...polar(44, toward - Math.PI * 0.75), hall, -0.02);
}

/** Palm groves on the patch-grid squares inside the garden ring, a quarter turn each at random. */
function groves(b: Build, seed: number, [cx, cz]: Point, edge: number) {
  const outer = edge + GARDENS,
    first = (v: number) => Math.floor((v - outer) / STAND_SIDE);
  for (let i = first(cx); (i - 0.5) * STAND_SIDE < cx + outer; i++)
    for (let j = first(cz); (j - 0.5) * STAND_SIDE < cz + outer; j++) {
      const [x, z] = [(i + 0.5) * STAND_SIDE, (j + 0.5) * STAND_SIDE],
        r = Math.hypot(x - cx, z - cz);
      if (r < edge + STAND_SIDE || r > outer) continue;
      b.site.place(GROVE, x, z, (Math.floor(hash01(seed + 5, i, j) * 4) * Math.PI) / 2);
    }
}

/**
 * The pool, the settlement's heart: at `site`, or as near it as the ground and the plan's roads
 * allow (a village road ends at the settlement's centre). Returns where it stands.
 */
function heart(b: Build, name: string, [x, z]: Point): Point {
  for (let k = 0; k < 80; k++) {
    const r = 12 * Math.sqrt(k),
      a = k * 2.39996,
      at: Point = [x + r * Math.cos(a), z + r * Math.sin(a)];
    if (b.site.place('desert/pool', ...at, 0, { name: `${name}/pool` })) return at;
  }
  return [x, z];
}

/** A dirt track from the town's edge to the highway, dust on its middle. */
function track(b: Build, name: string, [sx, sz]: Point, [jx, jz]: Point) {
  const n = Math.max(2, Math.ceil(Math.hypot(jx - sx, jz - sz) / 50)),
    points = Array.from({ length: n + 1 }, (_, i): Point => [
      sx + ((jx - sx) * i) / n,
      sz + ((jz - sz) * i) / n,
    ]);
  street(b, `${name}/track`, 'dirt', TRACK, points);
  const [mx, mz] = points[n >> 1];
  b.markers.push({
    kind: 'emitter',
    effect: 'road-dust',
    name: `${name}/track-dust`,
    position: [mx, b.plan.height(mx, mz), mz],
    radius: 80,
  });
}

/** The town's hall on one quarter, its market kept open on the opposite one. */
function civic(
  b: Build,
  name: string,
  [cx, cz]: Point,
  polar: (r: number, a: number) => Point,
  toward: number,
) {
  const hallAt = polar(100, toward + Math.PI * 0.25),
    market = toward + Math.PI * 1.25;
  placeLit(b, 'desert/domed-hall', ...hallAt, facing(cx - hallAt[0], cz - hallAt[1]), {
    name: `${name}/hall`,
  });
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 3; j++) {
      const [x, z] = polar(85 + i * 9, market + (j - 1) * 0.09);
      b.site.place(
        j % 2 ? 'desert/stall-fruit' : 'desert/stall-spice',
        x,
        z,
        facing(cx - x, cz - z),
      );
    }
  const square = { minX: -30, maxX: 30, minZ: -22, maxZ: 22, plinth: 0, sink: 0 };
  b.site.claim(corners(square, ...polar(100, market), market));
  return hallAt;
}

/** Houses on rings between the ring street and the edge, fronts toward the pool, and wells. */
function houses(
  b: Build,
  seed: number,
  [cx, cz]: Point,
  edge: number,
  polar: (r: number, a: number) => Point,
) {
  for (let r = 72, ring = 0; r < edge; r += 19, ring++)
    for (let a = 0, k = 0; a < Math.PI * 2; k++) {
      const roll = hash01(seed + 11, ring, k),
        big = r > 150 && roll > 0.8,
        manor = roll > 0.93 ? 'desert/courtyard-manor' : 'desert/courtyard-house',
        prop = big ? manor : HOUSES[Math.floor(roll * 1.25 * HOUSES.length) % HOUSES.length],
        [x, z] = polar(r, a);
      b.site.place(prop, x, z, facing(cx - x, cz - z), { clearance: 1.5 });
      a += (big ? 30 : 13) / r;
    }
  for (let i = 0; i < 4; i++) {
    const at = polar(between(seed + 12, i, 70, edge - 30), between(seed + 13, i, 0, 6.28));
    b.site.place('desert/well', ...at, 0);
  }
}
