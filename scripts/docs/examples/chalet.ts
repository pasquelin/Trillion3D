import { geometry } from '../../../packages/sdk-core/src/world/geometry/index.ts';
import { SceneGltf } from './gltf-scene.ts';
import { empty, fromGeometry, merge, type Mesh } from './mesh.ts';
import type { Vec3 } from './random.ts';

/** Footprint and storey of the chalet, in metres; its walls of octagonal logs, `LOG_RADIUS` in
 *  radius and `LOG_SEGMENTS` quads long; its balcony slabs and boards, `SLAB` thick. */
const WIDTH = 8,
  DEPTH = 6,
  GROUND = 2.8,
  LOGS_PER_WALL = 6,
  LOG_RADIUS = 0.12,
  LOG_SEGMENTS = 8,
  SLAB = 0.1;
/** The roof: ridge rise above the eaves, overhang past the walls, a board's width and length
 *  along the slope, and its thickness. */
const RISE = 2.6,
  OVERHANG = 1,
  BOARD = [0.6, 0.5] as const,
  THICKNESS = 0.03;

/** The point whose coordinate on axis `a` is `coordinate(a)`. */
const point = (coordinate: (a: number) => number): Vec3 => [0, 1, 2].map(coordinate) as never;

/** sdk-core's closed box of `size`, turned by `angle` around x, then centred on `at`: four
 *  vertices a face, as the open world's exporter writes them — twins in everything a page
 *  stores. */
const block = (size: Vec3, at: Vec3, angle = 0): Mesh => ({
  ...fromGeometry(
    geometry
      .box(...size)
      .rotateX(angle)
      .translate(...at),
  ),
  uvs: [],
});

/** The closed box from `min` to `max`. */
const slab = (min: Vec3, max: Vec3) =>
  block(
    point((a) => max[a] - min[a]),
    point((a) => (min[a] + max[a]) / 2),
  );

/** One corner of a quad, its position and its normal. */
type Corner = readonly [Vec3, Vec3];

/** Pushes a quad whose corners turn counter-clockwise seen from outside, on four vertices of its
 *  own, as `block` writes a box's faces. */
function pushQuad(mesh: Mesh, corners: readonly Corner[]) {
  const base = mesh.positions.length / 3;
  for (const [position, normal] of corners) {
    mesh.positions.push(...position);
    mesh.normals.push(...normal);
  }
  mesh.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

/** A closed octagonal log along `axis` from `start` over `length`: smooth sides, flat caps. */
function log(axis: number, start: Vec3, length: number): Mesh {
  const s = Math.SQRT1_2,
    ring = [
      [1, 0],
      [s, s],
      [0, 1],
      [-s, s],
      [-1, 0],
      [-s, -s],
      [0, -1],
      [s, -s],
    ] as const,
    [u, v] = [(axis + 1) % 3, (axis + 2) % 3];
  // `ring` turns from u toward v, counter-clockwise seen from the axis's positive end.
  const radial = ([cu, cv]: readonly number[]) => point((a) => (a === u ? cu : a === v ? cv : 0));
  const at = (along: number, r: readonly number[]): Vec3 =>
    point((a) => start[a] + (a === axis ? along : radial(r)[a] * LOG_RADIUS));
  const mesh = empty(),
    step = length / LOG_SEGMENTS;
  for (let segment = 0; segment < LOG_SEGMENTS; segment++)
    ring.forEach((r0, k) => {
      const r1 = ring[(k + 1) % ring.length],
        [t0, t1] = [segment * step, (segment + 1) * step];
      const side = (t: number, r: readonly number[]): Corner => [at(t, r), radial(r)];
      pushQuad(mesh, [side(t0, r0), side(t0, r1), side(t1, r1), side(t1, r0)]);
    });
  // Each cap, a fan of three quads, turned to face out of its end.
  for (const [along, sign] of [
    [0, -1],
    [length, 1],
  ]) {
    const normal = point((a) => (a === axis ? sign : 0));
    for (let k = 1; k < ring.length - 1; k += 2) {
      const fan = [ring[0], ring[k], ring[k + 1], ring[k + 2]].map((r): Corner => [
        at(along, r),
        normal,
      ]);
      pushQuad(mesh, sign > 0 ? fan : fan.reverse());
    }
  }
  return mesh;
}

/** The shingle roof over the walls, eaves at `eaves`, ridge along X: two slopes of staggered
 *  boards, each lapped by a third of its length, under a ridge cap, as the open world's
 *  `mountains` chalets lay it (#484) — thousands of closed parts, each below a coarse level's
 *  error, that together cover a wide surface. */
function shingleRoof(eaves: number): Mesh {
  const run = DEPTH / 2 + OVERHANG,
    angle = Math.atan2(RISE, run),
    slope = Math.hypot(RISE, run),
    along = WIDTH + 2 * OVERHANG,
    [bw, bl] = BOARD,
    lap = bl * (2 / 3),
    rows = Math.ceil((slope - bl) / lap) + 1,
    parts: Mesh[] = [];
  for (const side of [1, -1])
    for (let row = 0; row < rows; row++) {
      const s = Math.min(slope - bl / 2, bl / 2 + row * lap),
        odd = row % 2,
        start = -along / 2 - (odd * bw) / 2 + bw / 2,
        y = eaves + RISE - s * Math.sin(angle) + 0.02 + odd * 0.005,
        z = side * s * Math.cos(angle),
        count = Math.ceil(along / bw) + odd;
      for (let k = 0; k < count; k++) {
        const x = Math.min(Math.max(start + k * bw, -along / 2 + bw / 4), along / 2 - bw / 4);
        parts.push(block([bw * 0.94, THICKNESS, bl], [x, y, z], side * angle));
      }
    }
  const top = eaves + RISE + 0.04;
  parts.push(slab([-along / 2, top - 0.06, -0.17], [along / 2, top + 0.06, 0.17]));
  return merge(parts);
}

/**
 * `chalet`: a chalet of thin closed shapes (#415), the open world's `mountains/hotel` in small —
 * a whitewash box for the ground floor, walls of octagonal logs, balcony slabs and boards, a
 * shingle roof. Every part is a closed solid facing out, with the normals an exporter writes.
 * `see-the-triangles?model=chalet` opens its cook; the compiler's tests cook it (`thin_walls.rs`,
 * `root_cover.rs`).
 */
export async function writeChalet(directory: string) {
  const whitewash = slab([-WIDTH / 2, 0, -DEPTH / 2], [WIDTH / 2, GROUND, DEPTH / 2]),
    wood: Mesh[] = [];
  for (let k = 0; k < LOGS_PER_WALL; k++) {
    const y = GROUND + LOG_RADIUS * (1 + 2 * k);
    for (const side of [-1, 1])
      wood.push(
        log(0, [-WIDTH / 2 - LOG_RADIUS, y, (side * DEPTH) / 2], WIDTH + 2 * LOG_RADIUS),
        log(2, [(side * WIDTH) / 2, y, -DEPTH / 2], DEPTH),
      );
  }
  for (const side of [-1, 1]) {
    const [inner, outer] = [DEPTH / 2 + LOG_RADIUS, DEPTH / 2 + 1.3];
    const z = (a: number, b: number) => (side > 0 ? [a, b] : [-b, -a]);
    const [z0, z1] = z(inner, outer),
      [b0, b1] = z(outer - SLAB, outer);
    wood.push(slab([-WIDTH / 2, GROUND, z0], [WIDTH / 2, GROUND + SLAB, z1]));
    for (let board = 0; board < 10; board++) {
      const x = -WIDTH / 2 + board * 0.8;
      wood.push(slab([x, GROUND + SLAB, b0], [x + 0.4, GROUND + 1.1, b1]));
    }
  }
  const gltf = new SceneGltf();
  const parts = [
    [whitewash, gltf.material('whitewash', [0.9, 0.88, 0.82], { roughness: 0.9 })],
    [merge(wood), gltf.material('log wood', [0.42, 0.27, 0.15], { roughness: 0.8 })],
    [
      shingleRoof(GROUND + 2 * LOG_RADIUS * LOGS_PER_WALL),
      gltf.material('shingles', [0.3, 0.22, 0.17], { roughness: 0.85 }),
    ],
  ] as const;
  gltf.node({ name: 'chalet', mesh: gltf.mesh('chalet', parts) }, true);
  await gltf.write(directory, 'chalet');
}
