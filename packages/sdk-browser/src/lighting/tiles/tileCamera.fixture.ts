import {
  composeMatrix4,
  invertMatrix4,
  multiplyMatrix4,
  perspectiveProjection,
} from '../../../../sdk-core/src/index.ts';
import type { TileView } from '../../../../../bench/oracles/browser/gpuLightTileColumnOracle.ts';

// The views and world points the tile-bounds tests draw lights around, in f64.

export type Vec3 = [number, number, number];
/** The near distance of every test camera. */
export const NEAR = 0.1;

/** A camera at `eye`, turned by `yaw` about +Y then `pitch` about +X (−90° looks straight down). */
export function camera(
  eye: Vec3,
  yaw: number,
  pitch: number,
  fov: number,
  width: number,
  height: number,
) {
  const [sy, cy, sp, cp] = [
    Math.sin(yaw / 2),
    Math.cos(yaw / 2),
    Math.sin(pitch / 2),
    Math.cos(pitch / 2),
  ];
  const world = composeMatrix4(
    new Float64Array(16),
    eye,
    [cy * sp, sy * cp, -sy * sp, cy * cp],
    [1, 1, 1],
  );
  const projection = perspectiveProjection(new Float64Array(16), fov, width / height, NEAR, 1);
  const viewProjection = multiplyMatrix4(
    new Float64Array(16),
    projection,
    invertMatrix4(new Float64Array(16), world),
  );
  return {
    inverseViewProjection: invertMatrix4(new Float64Array(16), viewProjection),
    width,
    height,
  };
}

/** The world point of a pixel centre at depth `z`, in f64: where the resolve shades. */
export function pixelPoint(view: TileView, px: number, py: number, z: number): Vec3 {
  const m = view.inverseViewProjection,
    x = ((px + 0.5) / view.width) * 2 - 1,
    y = 1 - ((py + 0.5) / view.height) * 2;
  const w = m[3] * x + m[7] * y + m[11] * z + m[15];
  return [0, 1, 2].map((r) => (m[r] * x + m[r + 4] * y + m[r + 8] * z + m[r + 12]) / w) as Vec3;
}

/** Distance from `c` to the segment `a`–`b`. */
export function segmentDistance(a: Vec3, b: Vec3, c: Vec3) {
  const ab = [0, 1, 2].map((i) => b[i] - a[i]),
    ac = [0, 1, 2].map((i) => c[i] - a[i]);
  const t = Math.min(
    1,
    Math.max(0, ab.reduce((s, v, i) => s + v * ac[i], 0) / ab.reduce((s, v) => s + v * v, 0) || 0),
  );
  return Math.hypot(...[0, 1, 2].map((i) => a[i] + t * ab[i] - c[i]));
}
