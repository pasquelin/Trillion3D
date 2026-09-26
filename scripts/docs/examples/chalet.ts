import { SceneGltf } from './gltf-scene.ts';
import {
  boxTriangles,
  LOG_RADIUS,
  point,
  pushBox,
  pushLog,
  pushPart,
  type Corner,
  type Triangle,
} from './closed-parts.ts';
import { empty, type Mesh } from './mesh.ts';
import type { Vec3 } from './random.ts';

/** Footprint and storey of the chalet, in metres; its walls of logs, 0.12 m in radius
 *  (`closed-parts.ts`); its balcony slabs and boards, 0.1 m thick. */
const WIDTH = 8,
  DEPTH = 6,
  GROUND = 2.8,
  LOGS_PER_WALL = 6,
  SLAB = 0.1;
/** The roof: ridge rise above the eaves, overhang past the walls, a board's width and length
 *  along the slope, and its thickness. */
const RISE = 2.6,
  OVERHANG = 1,
  BOARD = [0.6, 0.5] as const,
  THICKNESS = 0.03;

/** One shingle centred on `at`, pitched down the slope by the angle of sine `sin` and cosine
 *  `cos`, mirrored across the ridge when `side` is negative. */
function pushShingle(mesh: Mesh, at: Vec3, [sin, cos]: readonly number[], side: number) {
  const half: Vec3 = [BOARD[0] * 0.47, THICKNESS / 2, BOARD[1] / 2];
  const turn = ([x, y, z]: Vec3): Vec3 => [x, y * cos - z * sin, (y * sin + z * cos) * side];
  const centre: Vec3 = [at[0], at[1], at[2] * side],
    move = ([p, n]: Corner): Corner => {
      const turned = turn(p);
      return [point((a) => turned[a] + centre[a]), turn(n)];
    };
  const triangles = boxTriangles(
    point((a) => -half[a]),
    half,
  ).map(([a, b, c]): Triangle => [move(a), move(b), move(c)]);
  pushPart(mesh, triangles, centre);
}

/** The shingle roof over the walls, eaves at `eaves`, ridge along X: two slopes of staggered
 *  boards, each lapped by a third of its length, under a ridge cap, as the open world's
 *  `mountains` chalets lay it (#484) — thousands of closed parts, each below a coarse level's
 *  error, that together cover a wide surface. */
function shingleRoof(eaves: number): Mesh {
  const mesh = empty();
  const run = DEPTH / 2 + OVERHANG,
    angle = Math.atan2(RISE, run),
    pitch = [Math.sin(angle), Math.cos(angle)],
    slope = Math.hypot(RISE, run),
    along = WIDTH + 2 * OVERHANG,
    [bw, bl] = BOARD,
    lap = bl * (2 / 3),
    rows = Math.ceil((slope - bl) / lap) + 1;
  for (const side of [1, -1])
    for (let row = 0; row < rows; row++) {
      const s = Math.min(slope - bl / 2, bl / 2 + row * lap),
        odd = row % 2,
        start = -along / 2 - (odd * bw) / 2 + bw / 2,
        y = eaves + RISE - s * pitch[0] + 0.02 + odd * 0.005,
        count = Math.ceil(along / bw) + odd;
      for (let k = 0; k < count; k++) {
        const x = Math.min(Math.max(start + k * bw, -along / 2 + bw / 4), along / 2 - bw / 4);
        pushShingle(mesh, [x, y, s * pitch[1]], pitch, side);
      }
    }
  const top = eaves + RISE + 0.04;
  pushBox(mesh, [-along / 2, top - 0.06, -0.17], [along / 2, top + 0.06, 0.17]);
  return mesh;
}

/**
 * `chalet`: a chalet of thin closed shapes (#415), the open world's `mountains/hotel` in small —
 * a whitewash box for the ground floor, walls of octagonal 0.12 m logs, balcony slabs and boards
 * 0.1 m thick, a shingle roof. Every part is a closed solid whose faces point away from its
 * centre, with the normals an exporter writes. `see-the-triangles?model=chalet` opens its cook;
 * the compiler's tests cook it (`thin_walls.rs`).
 */
export async function writeChalet(directory: string) {
  const [whitewash, wood] = [empty(), empty()];
  pushBox(whitewash, [-WIDTH / 2, 0, -DEPTH / 2], [WIDTH / 2, GROUND, DEPTH / 2]);
  for (let k = 0; k < LOGS_PER_WALL; k++) {
    const y = GROUND + LOG_RADIUS * (1 + 2 * k);
    for (const side of [-1, 1]) {
      pushLog(wood, 0, [-WIDTH / 2 - LOG_RADIUS, y, (side * DEPTH) / 2], WIDTH + 2 * LOG_RADIUS);
      pushLog(wood, 2, [(side * WIDTH) / 2, y, -DEPTH / 2], DEPTH);
    }
  }
  for (const side of [-1, 1]) {
    const [inner, outer] = [DEPTH / 2 + LOG_RADIUS, DEPTH / 2 + 1.3];
    const z = (a: number, b: number) => (side > 0 ? [a, b] : [-b, -a]);
    const [z0, z1] = z(inner, outer),
      [b0, b1] = z(outer - SLAB, outer);
    pushBox(wood, [-WIDTH / 2, GROUND, z0], [WIDTH / 2, GROUND + SLAB, z1]);
    for (let board = 0; board < 10; board++) {
      const x = -WIDTH / 2 + board * 0.8;
      pushBox(wood, [x, GROUND + SLAB, b0], [x + 0.4, GROUND + 1.1, b1]);
    }
  }
  const gltf = new SceneGltf();
  const parts = [
    [whitewash, gltf.material('whitewash', [0.9, 0.88, 0.82], { roughness: 0.9 })],
    [wood, gltf.material('log wood', [0.42, 0.27, 0.15], { roughness: 0.8 })],
    [
      shingleRoof(GROUND + 2 * LOG_RADIUS * LOGS_PER_WALL),
      gltf.material('shingles', [0.3, 0.22, 0.17], { roughness: 0.85 }),
    ],
  ] as const;
  gltf.node({ name: 'chalet', mesh: gltf.mesh('chalet', parts) }, true);
  await gltf.write(directory, 'chalet');
}
