/**
 * Oracle of the opaque slice's depth mask (#1369), a line-by-line port of
 * packages/sdk-browser/src/lighting/tiles/depthMaskWgsl.ts, every operation rounded to f32, on the
 * corner table of `gpuLightTileColumnOracle.ts` (`tileBounds(...).corners`).
 */
import { DEPTH_BINS } from '../../../packages/sdk-browser/src/lighting/tiles/depthMaskWgsl.ts';
import {
  ROW,
  cross,
  dot,
  scale,
  sub,
  unproject,
  type TileView,
  type Vec3,
} from './gpuLightTileColumnOracle.ts';

const f = Math.fround;
const DEPTH_MARGIN = 2 ** -12;

export type DepthAxis = { along: Vec3; first: number; scale: number; reach: number };

/** `depthAxis`: the near plane's normal from the deep row, the slab's depths along it. */
export function depthAxis(corners: Vec3[]): DepthAxis {
  const deep = (i: number) => corners[ROW.deep * 4 + (i ^ (i >> 1))];
  const first = deep(0);
  const normal = cross(sub(deep(1), first), sub(deep(3), first));
  const along = scale(normal, f(1 / f(Math.sqrt(dot(normal, normal)))));
  const front = dot(along, corners[ROW.front * 4]),
    back = dot(along, corners[ROW.back * 4]);
  return {
    along,
    first: Math.min(front, back),
    scale: f(DEPTH_BINS / Math.max(Math.abs(f(back - front)), f(1e-20))),
    reach: Math.max(Math.abs(front), Math.abs(back)),
  };
}

/** `depthBin`: monotone in `d`, clamped to the mask. */
export const depthBin = (axis: DepthAxis, d: number) =>
  Math.min(Math.max(Math.floor(f(f(d - axis.first) * axis.scale)), 0), DEPTH_BINS - 1);

/** `pixelDepthBit`: the bit of pixel `px, py`'s centre at depth `z`. */
export function pixelDepthBit(view: TileView, axis: DepthAxis, px: number, py: number, z: number) {
  const x = f(f(f(f(px + 0.5) / view.width) * 2) - 1),
    y = f(1 - f(f(f(py + 0.5) / view.height) * 2));
  const at = unproject(view.inverseViewProjection, x, y, f(z));
  return (1 << depthBin(axis, dot(axis.along, at))) >>> 0;
}

/** `depthBinsHit`: whether a sphere, in the pass's frame, covers a bin of `bins`. */
export function depthBinsHit(bins: number, axis: DepthAxis, centre: Vec3, radius: number) {
  const d = dot(axis.along, centre);
  const reach = f(radius + f(f(Math.abs(d) + axis.reach) * DEPTH_MARGIN));
  const lo = Math.max(depthBin(axis, f(d - reach)), 1) - 1;
  const hi = Math.min(depthBin(axis, f(d + reach)) + 1, DEPTH_BINS - 1);
  return ((bins & (0xffffffff >>> (DEPTH_BINS - 1 - hi)) & ((0xffffffff << lo) >>> 0)) >>> 0) !== 0;
}
