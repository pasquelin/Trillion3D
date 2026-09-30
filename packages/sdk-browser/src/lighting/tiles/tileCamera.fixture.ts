import {
  composeMatrix4,
  dotVector3,
  invertMatrix4,
  multiplyMatrix4,
  perspectiveProjection,
  transformHomogeneousPoint,
} from '../../../../sdk-core/src/index.ts';
import { localTurnQuaternion } from '../../../../sdk-core/src/math/matrix/quaternion.ts';
import type { TileView } from '../../../../../bench/oracles/browser/gpuLightTileColumnOracle.ts';
import { LIGHT_SETTINGS } from '../../../../sdk-core/src/index.ts';
import { random } from '../../page/cut/cutRuleChecks.fixture.ts';
import { tileViewInverse } from './tileFrame.ts';

// The views and world points the tile-bounds tests draw lights around, in f64.

export type Vec3 = [number, number, number];
/** The near distance of every test camera. */
export const NEAR = 0.1;

/** A camera at `eye`, turned by `yaw` about +Y then `pitch` about +X (−90° looks straight down),
 *  in the pass's frame, as `update` writes it; with the render matrix and eye `update` takes. */
export function camera(
  eye: Vec3,
  yaw: number,
  pitch: number,
  fov: number,
  width: number,
  height: number,
) {
  const m4 = () => new Float64Array(16);
  const turn = localTurnQuaternion(new Float64Array(4), pitch, yaw, 0, 'YXZ');
  const world = composeMatrix4(m4(), eye, turn, [1, 1, 1]);
  const projection = perspectiveProjection(m4(), fov, width / height, NEAR, 1);
  const viewProjection = multiplyMatrix4(m4(), projection, invertMatrix4(m4(), world));
  const origin = new Float64Array(3);
  const inverseViewProjection = tileViewInverse(m4(), origin, viewProjection, eye);
  return { inverseViewProjection, origin, width, height, viewProjection, eye };
}

/** The world point of a pixel centre at depth `z`, in f64: where the resolve shades. */
export function pixelPoint(view: TileView, px: number, py: number, z: number): Vec3 {
  const x = ((px + 0.5) / view.width) * 2 - 1,
    y = 1 - ((py + 0.5) / view.height) * 2;
  const p = transformHomogeneousPoint([0, 0, 0, 0], view.inverseViewProjection, x, y, z);
  return [0, 1, 2].map((i) => p[i] / p[3] + view.origin[i]) as Vec3;
}

/** The view distance the pixel rays of `pixelRay` reach: depth NEAR / FAR_CAST. */
const FAR_CAST = 1e5;

/** The ray through a pixel centre, from the near plane (`s` = 0) to the view distance
 *  FAR_CAST (`s` = 1); the view distance, hence the depth, is linear in `s` along it. */
export function pixelRay(view: TileView, px: number, py: number) {
  const o = pixelPoint(view, px, py, 1),
    far = pixelPoint(view, px, py, NEAR / FAR_CAST);
  return { o, d: [far[0] - o[0], far[1] - o[1], far[2] - o[2]] as Vec3 };
}

/** The ray parameter of `pixelRay` at view distance `distance`. */
export const rayParameter = (distance: number) => (distance - NEAR) / (FAR_CAST - NEAR);

/** The depth the buffer holds at parameter `s` of a `pixelRay`. */
export const rayDepth = (s: number) => NEAR / (NEAR + s * (FAR_CAST - NEAR));

/** Distance from `c` to the segment `a`–`b`. */
export function segmentDistance(a: Vec3, b: Vec3, c: Vec3) {
  const ab = [0, 1, 2].map((i) => b[i] - a[i]),
    ac = [0, 1, 2].map((i) => c[i] - a[i]);
  const t = Math.min(1, Math.max(0, dotVector3(ab, ac) / dotVector3(ab, ab) || 0));
  return Math.hypot(...ab.map((v, i) => v * t - ac[i]));
}

const SIZE = LIGHT_SETTINGS.tileSize;
/** Pixel `i` of the tile, row by row. */
export const tilePixel = (tile: number[], i: number) =>
  [tile[0] * SIZE + (i % SIZE), tile[1] * SIZE + Math.floor(i / SIZE)] as const;

/** A random view, tile, depth field and lights near the tile's pixels. */
export function randomCase(seed: number, pitch: number) {
  const r = random(seed),
    u = (lo: number, hi: number) => lo + (hi - lo) * r();
  const [width, height] = [Math.round(u(320, 1920)), Math.round(u(240, 1080))];
  const far = seed % 4 === 0 ? 150_000 : 5000;
  const eye: Vec3 = [u(-far, far), u(1.7, 2000), u(-far, far)];
  const view = camera(eye, u(-Math.PI, Math.PI), pitch, u(30, 100), width, height);
  const tile: [number, number] = [
    Math.floor(r() * Math.ceil(width / SIZE)),
    Math.floor(r() * Math.ceil(height / SIZE)),
  ];
  // A slanted surface, its distance growing across the tile, with a few pixels on nearer objects.
  const [d0, dx, dy] = [Math.exp(u(Math.log(0.12), Math.log(3000))), u(-0.3, 0.3), u(-0.3, 0.3)];
  const depths = [...Array(SIZE * SIZE).keys()].map((i) => {
    const d =
      d0 *
      (1 + (dx * (i % SIZE) + dy * Math.floor(i / SIZE)) / SIZE) *
      (r() < 0.05 ? u(0.2, 1) : 1);
    return Math.fround(Math.min(1, NEAR / Math.max(d, NEAR)));
  });
  const lights = [...Array(60).keys()].map(() => {
    const i = Math.floor(r() * depths.length);
    const at = pixelPoint(view, ...tilePixel(tile, i), depths[i]);
    const radius = Math.exp(u(Math.log(0.01), Math.log(200)));
    const reach = u(0, 2) * radius;
    const dir = [u(-1, 1), u(-1, 1), u(-1, 1)],
      len = Math.hypot(...dir) || 1;
    return {
      centre: at.map((v, a) => Math.fround(v + (dir[a] / len) * reach)) as Vec3,
      radius: Math.fround(radius),
    };
  });
  return { view, tile, depths, lights };
}
