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
import { tileViewInverse } from './tiles.ts';

// The views and world points the tile-bounds tests draw lights around, in f64.

export type Vec3 = [number, number, number];
/** The near distance of every test camera. */
export const NEAR = 0.1;

/** A camera at `eye`, turned by `yaw` about +Y then `pitch` about +X (−90° looks straight down),
 *  in the pass's frame, as `update` writes it. */
export function camera(
  eye: Vec3,
  yaw: number,
  pitch: number,
  fov: number,
  width: number,
  height: number,
): TileView {
  const m4 = () => new Float64Array(16);
  const turn = localTurnQuaternion(new Float64Array(4), pitch, yaw, 0, 'YXZ');
  const world = composeMatrix4(m4(), eye, turn, [1, 1, 1]);
  const projection = perspectiveProjection(m4(), fov, width / height, NEAR, 1);
  const viewProjection = multiplyMatrix4(m4(), projection, invertMatrix4(m4(), world));
  const origin = new Float64Array(3);
  const inverseViewProjection = tileViewInverse(m4(), origin, viewProjection, eye);
  return { inverseViewProjection, origin, width, height };
}

/** The world point of a pixel centre at depth `z`, in f64: where the resolve shades. */
export function pixelPoint(view: TileView, px: number, py: number, z: number): Vec3 {
  const x = ((px + 0.5) / view.width) * 2 - 1,
    y = 1 - ((py + 0.5) / view.height) * 2;
  const p = transformHomogeneousPoint([0, 0, 0, 0], view.inverseViewProjection, x, y, z);
  return [0, 1, 2].map((i) => p[i] / p[3] + view.origin[i]) as Vec3;
}

/** Distance from `c` to the segment `a`–`b`. */
export function segmentDistance(a: Vec3, b: Vec3, c: Vec3) {
  const ab = [0, 1, 2].map((i) => b[i] - a[i]),
    ac = [0, 1, 2].map((i) => c[i] - a[i]);
  const t = Math.min(1, Math.max(0, dotVector3(ab, ac) / dotVector3(ab, ab) || 0));
  return Math.hypot(...ab.map((v, i) => v * t - ac[i]));
}
