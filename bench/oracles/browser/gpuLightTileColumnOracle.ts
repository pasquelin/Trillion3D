/**
 * Oracle of a tile's bounds, a line-by-line port of packages/sdk-browser/src/lighting/tiles/
 * {shader,boundsWgsl}.ts, corner table included, every operation rounded to f32.
 * `inverseViewProjection` is column-major and maps to the frame of `origin` (`tileViewInverse`),
 * where points are given (`toTileFrame`).
 */
import { LIGHT_SETTINGS } from '../../../packages/sdk-core/src/index.ts';
import { DEPTH_NEAR } from '../../../packages/sdk-browser/src/camera/depthConvention.ts';

export type Vec3 = [number, number, number];
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
export const sub = (a: Vec3, b: Vec3) => map((i) => f(a[i] - b[i]));
export const scale = (a: Vec3, s: number) => map((i) => f(a[i] * s));
export const dot = (a: Vec3, b: Vec3) => f(f(f(a[0] * b[0]) + f(a[1] * b[1])) + f(a[2] * b[2]));
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  f(f(a[1] * b[2]) - f(a[2] * b[1])),
  f(f(a[2] * b[0]) - f(a[0] * b[2])),
  f(f(a[0] * b[1]) - f(a[1] * b[0])),
];

export const toTileFrame = (view: TileView, point: Vec3) =>
  map((i) => f(f(point[i]) - f(view.origin[i])));

export function unproject(m: ArrayLike<number>, x: number, y: number, z: number): Vec3 {
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

/** The corner table sixteen lanes fill, `corners[row * 4 + corner]`: the rows are the near
 *  plane, the column's depth, the tile's front and its back. */
export const ROW = { near: 0, deep: 1, front: 2, back: 3 };
export function tileCorners(view: TileView, tile: [number, number], front: number, back: number) {
  const depths = [DEPTH_NEAR, DEPTH_NEAR / 1024, front, back];
  return [...Array(16).keys()].map((lane) =>
    tileCorner(view, tile, lane % 4, depths[Math.floor(lane / 4)]),
  );
}

/** The box of a set of points: the min and max of each axis. */
export const boxOf = (points: Vec3[]): Box => ({
  lo: map((a) => Math.min(...points.map((p) => p[a]))),
  hi: map((a) => Math.max(...points.map((p) => p[a]))),
});

const tileBox = (corners: Vec3[], front: number, back: number) =>
  boxOf([...Array(8).keys()].map((c) => corners[(c & 4 ? back : front) * 4 + (c & 3)]));

function inwardPlane(normal: Vec3, point: Vec3, inside: Vec3): Plane {
  const n = scale(normal, f(1 / f(Math.sqrt(dot(normal, normal)))));
  const facing = dot(n, sub(inside, point)) >= 0 ? n : scale(n, -1);
  return { n: facing, w: -dot(facing, point) };
}

export function tileColumn(corners: Vec3[]) {
  // `columnCorner`: the `i`th corner of a row in turn around the tile, the Gray code of `i`.
  const near = (i: number) => corners[ROW.near * 4 + (i ^ (i >> 1))];
  const deep = (i: number) => corners[ROW.deep * 4 + (i ^ (i >> 1))];
  const row = ROW.deep * 4; // the centre summed in the table's order
  const inside = scale(
    add(add(add(corners[row], corners[row + 1]), corners[row + 2]), corners[row + 3]),
    0.25,
  );
  const planes = [0, 1, 2, 3].map((i) =>
    inwardPlane(cross(sub(deep((i + 1) % 4), deep(i)), sub(deep(i), near(i))), near(i), inside),
  );
  planes.push(inwardPlane(cross(sub(deep(1), deep(0)), sub(deep(3), deep(0))), near(0), inside));
  return planes;
}

/** The opaque slice's front and back planes: the column's near normal through each depth. */
function tileSlab(corners: Vec3[], column: Plane[]): Plane[] {
  const away = column[4].n;
  const at = (row: number) => dot(away, corners[row * 4]);
  return [
    { n: away, w: -at(ROW.front) },
    { n: scale(away, -1), w: at(ROW.back) },
  ];
}

const sphereBehind = (plane: Plane, centre: Vec3, radius: number) =>
  f(dot(plane.n, centre) + plane.w) < -radius;

const sphereInSides = (column: Plane[], centre: Vec3, radius: number) =>
  column.slice(0, 4).every((plane) => !sphereBehind(plane, centre, radius));

export const sphereTouchesColumn = (column: Plane[], centre: Vec3, radius: number) =>
  column.every((plane) => !sphereBehind(plane, centre, radius));

export function sphereTouchesBox(box: Box, centre: Vec3, radius: number) {
  const clamped = map((a) => Math.max(f(box.lo[a] - centre[a]), f(centre[a] - box.hi[a]), 0));
  return dot(clamped, clamped) <= f(radius * radius);
}

export type TileBounds = {
  opaqueBox: Box;
  blendBox: Box;
  column: Plane[];
  slab: Plane[];
  corners: Vec3[];
};

/** What the tile's threads build for a tile whose opaque pixels span `front` to `back`. */
export function tileBounds(view: TileView, tile: [number, number], front: number, back: number) {
  const corners = tileCorners(view, tile, front, back);
  const column = tileColumn(corners);
  return {
    opaqueBox: tileBox(corners, ROW.front, ROW.back),
    blendBox: tileBox(corners, ROW.near, ROW.back),
    column,
    slab: tileSlab(corners, column),
    corners,
  };
}

/** `sliceHits` of a light other than the sun on a tile `tileBounds` built, with no sky pixel —
 *  `hasOpaque` true, `seesSky` false —, `centre` in the pass's frame. */
export function sliceHits(bounds: TileBounds, centre: Vec3, radius: number) {
  const { opaqueBox, blendBox, column, slab } = bounds;
  const inSlices = sphereInSides(column, centre, radius) && !sphereBehind(slab[1], centre, radius);
  const opaque =
    sphereTouchesBox(opaqueBox, centre, radius) && !sphereBehind(slab[0], centre, radius);
  const blend =
    sphereTouchesBox(blendBox, centre, radius) && !sphereBehind(column[4], centre, radius);
  return { opaque: inSlices && opaque, blend: inSlices && blend };
}
