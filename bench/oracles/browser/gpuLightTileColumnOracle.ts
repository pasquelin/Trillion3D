/**
 * Oracle of a tile's bounds, a line-by-line port of `tileCorner`, `inwardPlane`, `tileColumn`,
 * `sphereTouchesColumn` (packages/sdk-browser/src/lighting/tiles/shader.ts) and of `tileCorners`,
 * `boxOf`, `tileSlab`, `sphereBehind`, `sphereInSides` and `sliceHits` (`boundsWgsl.ts` beside it).
 * Every operation is rounded to f32 as the shader's is. `inverseViewProjection` is column-major,
 * like the uniform, and maps to the frame of `origin` (`tileViewInverse`); depth is reversed with
 * an infinite far plane. Points and centres given here are in that frame (`toTileFrame`).
 */
import { LIGHT_SETTINGS } from '../../../packages/sdk-core/src/index.ts';
import { DEPTH_NEAR } from '../../../packages/sdk-browser/src/camera/depthConvention.ts';

type Vec3 = [number, number, number];
type Corners = [Vec3, Vec3, Vec3, Vec3];
export type TileView = {
  inverseViewProjection: ArrayLike<number>;
  origin: ArrayLike<number>;
  width: number;
  height: number;
};
export type Plane = { n: Vec3; w: number };
export type Box = { lo: Vec3; hi: Vec3 };

const f = Math.fround;
const map = (g: (a: number) => number): Vec3 => [g(0), g(1), g(2)];
const add = (a: Vec3, b: Vec3) => map((i) => f(a[i] + b[i]));
const sub = (a: Vec3, b: Vec3) => map((i) => f(a[i] - b[i]));
const scale = (a: Vec3, s: number) => map((i) => f(a[i] * s));
const dot = (a: Vec3, b: Vec3) => f(f(f(a[0] * b[0]) + f(a[1] * b[1])) + f(a[2] * b[2]));
const cross = (a: Vec3, b: Vec3): Vec3 => [
  f(f(a[1] * b[2]) - f(a[2] * b[1])),
  f(f(a[2] * b[0]) - f(a[0] * b[2])),
  f(f(a[0] * b[1]) - f(a[1] * b[0])),
];

/** A world point, as the uniform and the light buffer hold it, in the pass's frame. */
export const toTileFrame = (view: TileView, point: Vec3) =>
  map((i) => f(f(point[i]) - f(view.origin[i])));

function unproject(m: ArrayLike<number>, x: number, y: number, z: number): Vec3 {
  const row = (r: number) =>
    f(f(f(f(f(m[r]) * x) + f(f(m[r + 4]) * y)) + f(f(m[r + 8]) * z)) + f(m[r + 12]));
  const w = row(3);
  return map((r) => f(row(r) / w));
}

export function tileCorner(view: TileView, tile: [number, number], corner: number, z: number) {
  const size = LIGHT_SETTINGS.tileSize;
  const edge = (t: number, far: number, extent: number) =>
    far ? Math.min(f(((t + 1) * size) / extent), 1) : f((t * size) / extent);
  const x = edge(tile[0], corner & 1, view.width);
  const y = edge(tile[1], corner & 2, view.height);
  return unproject(view.inverseViewProjection, f(f(x * 2) - 1), f(1 - f(y * 2)), f(z));
}

const tileCorners = (view: TileView, tile: [number, number], z: number) =>
  [0, 1, 2, 3].map((c) => tileCorner(view, tile, c, z)) as Corners;

function boxOf(a: Corners, b: Corners): Box {
  const all = [...a, ...b];
  return {
    lo: map((i) => Math.min(...all.map((p) => p[i]))),
    hi: map((i) => Math.max(...all.map((p) => p[i]))),
  };
}

function inwardPlane(normal: Vec3, point: Vec3, inside: Vec3): Plane {
  const n = scale(normal, f(1 / f(Math.sqrt(dot(normal, normal)))));
  const facing = dot(n, sub(inside, point)) >= 0 ? n : scale(n, -1);
  return { n: facing, w: -dot(facing, point) };
}

function columnOf(near: Corners, deep: Corners) {
  const order = [0, 1, 3, 2];
  const inside = scale(add(add(add(deep[0], deep[1]), deep[2]), deep[3]), 0.25);
  const planes = order.map((at, i) => {
    const next = order[(i + 1) % 4];
    return inwardPlane(cross(sub(deep[next], deep[at]), sub(deep[at], near[at])), near[at], inside);
  });
  planes.push(inwardPlane(cross(sub(deep[1], deep[0]), sub(deep[2], deep[0])), near[0], inside));
  return planes;
}

export const tileColumn = (view: TileView, tile: [number, number]) =>
  columnOf(tileCorners(view, tile, DEPTH_NEAR), tileCorners(view, tile, DEPTH_NEAR / 1024));

const sphereBehind = (plane: Plane, centre: Vec3, radius: number) =>
  f(dot(plane.n, centre) + plane.w) < -radius;

const sphereInSides = (column: Plane[], centre: Vec3, radius: number) =>
  column.slice(0, 4).every((plane) => !sphereBehind(plane, centre, radius));

export const sphereTouchesColumn = (column: Plane[], centre: Vec3, radius: number) =>
  sphereInSides(column, centre, radius) && !sphereBehind(column[4], centre, radius);

export function sphereTouchesBox(box: Box, centre: Vec3, radius: number) {
  const clamped = map((a) => Math.max(f(box.lo[a] - centre[a]), f(centre[a] - box.hi[a]), 0));
  return dot(clamped, clamped) <= f(radius * radius);
}

export type TileBounds = { opaqueBox: Box; blendBox: Box; column: Plane[]; slab: Plane[] };

/** What thread zero builds for a tile whose opaque pixels span `front` to `back`. */
export function tileBounds(view: TileView, tile: [number, number], front: number, back: number) {
  const near = tileCorners(view, tile, DEPTH_NEAR);
  const column = columnOf(near, tileCorners(view, tile, DEPTH_NEAR / 1024));
  const [frontCorners, backCorners] = [
    tileCorners(view, tile, front),
    tileCorners(view, tile, back),
  ];
  const away = column[4].n;
  return {
    opaqueBox: boxOf(frontCorners, backCorners),
    blendBox: boxOf(near, backCorners),
    column,
    slab: [
      { n: away, w: -dot(away, frontCorners[0]) },
      { n: scale(away, -1), w: dot(away, backCorners[0]) },
    ],
  };
}

/** `sliceHits` of a light other than the sun, `centre` in the pass's frame. */
export function sliceHits(bounds: TileBounds, centre: Vec3, radius: number, seesSky: boolean) {
  const { opaqueBox, blendBox, column, slab } = bounds;
  const hit = { opaque: false, blend: seesSky && sphereTouchesColumn(column, centre, radius) };
  if (sphereInSides(column, centre, radius) && !sphereBehind(slab[1], centre, radius)) {
    hit.opaque =
      sphereTouchesBox(opaqueBox, centre, radius) && !sphereBehind(slab[0], centre, radius);
    if (!seesSky)
      hit.blend =
        sphereTouchesBox(blendBox, centre, radius) && !sphereBehind(column[4], centre, radius);
  }
  return hit;
}
