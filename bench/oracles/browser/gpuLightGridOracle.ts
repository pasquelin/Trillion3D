/**
 * Oracle of the light grid's cells (#1369), a line-by-line port of
 * packages/sdk-browser/src/lighting/tiles/boundsWgsl.ts, every operation rounded to f32: a column's
 * corners, planes and slices; the run of its slices a light meets is `gpuLightGridRunOracle.ts`. The inverse matrix
 * is column-major and maps to the frame of `origin` (`tileViewInverse`), where points are given
 * (`toTileFrame`); `depthRows` are the render matrix's depth and w rows in that frame.
 */
import { LIGHT_SETTINGS } from '../../../packages/sdk-core/src/index.ts';
import { DEPTH_NEAR } from '../../../packages/sdk-browser/src/camera/depthConvention.ts';

export type Vec3 = [number, number, number];
export type TileView = {
  inverseViewProjection: ArrayLike<number>;
  origin: ArrayLike<number>;
  width: number;
  height: number;
  /** The render matrix's depth row then its w row, in the pass's frame: eight numbers. */
  depthRows: ArrayLike<number>;
};
export type Plane = { n: Vec3; w: number };
export type Box = { lo: Vec3; hi: Vec3 };
/** The grid's cell side in pixels, its slices, and its slices per doubling of the view depth. */
export type Grid = { cell: number; slices: number; perOctave: number };
export const GRID: Grid = {
  cell: LIGHT_SETTINGS.tileSize,
  slices: LIGHT_SETTINGS.gridSlices,
  perOctave: LIGHT_SETTINGS.gridSlicesPerOctave,
};

export const f = Math.fround;
export const map = (g: (a: number) => number): Vec3 => [g(0), g(1), g(2)];
export const add = (a: Vec3, b: Vec3) => map((i) => f(a[i] + b[i]));
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

function unproject(m: ArrayLike<number>, x: number, y: number, z: number): Vec3 {
  const row = (r: number) =>
    f(f(f(f(f(m[r]) * x) + f(f(m[r + 4]) * y)) + f(f(m[r + 8]) * z)) + f(m[r + 12]));
  const w = row(3);
  return map((r) => f(row(r) / w));
}

/** `gridSlice`: the slice of a pixel of depth `z`, `perOctave` a doubling of its view depth. */
export const gridSlice = (z: number, grid = GRID) =>
  Math.trunc(
    Math.min(Math.max(f(-f(Math.log2(Math.max(z, 1e-30))) * grid.perOctave), 0), grid.slices - 1),
  );

/** `cellCorner`: a column's corner — bit 0 the right edge, bit 1 the bottom — at depth `z`. */
export function cellCorner(
  view: TileView,
  cell: [number, number],
  corner: number,
  z: number,
  grid = GRID,
) {
  const edge = (t: number, far: number, extent: number) =>
    far ? Math.min(f(((t + 1) * grid.cell) / extent), 1) : f((t * grid.cell) / extent);
  const x = edge(cell[0], corner & 1, view.width);
  const y = edge(cell[1], corner & 2, view.height);
  return unproject(view.inverseViewProjection, f(f(x * 2) - 1), f(1 - f(y * 2)), f(z));
}

function inwardPlane(normal: Vec3, point: Vec3, inside: Vec3): Plane {
  const n = scale(normal, f(1 / f(Math.sqrt(dot(normal, normal)))));
  const facing = dot(n, sub(inside, point)) >= 0 ? n : scale(n, -1);
  return { n: facing, w: -dot(facing, point) };
}

/** `columnPlane`: the column's four side planes, then its near plane, facing its inside. */
export function cellColumn(view: TileView, cell: [number, number], grid = GRID) {
  const near = (i: number) => cellCorner(view, cell, i ^ (i >> 1), DEPTH_NEAR, grid);
  const deep = (i: number) => cellCorner(view, cell, i ^ (i >> 1), DEPTH_NEAR / 1024, grid);
  const rows = [0, 1, 2, 3].map((c) => cellCorner(view, cell, c, DEPTH_NEAR / 1024, grid));
  const inside = scale(add(add(add(rows[0], rows[1]), rows[2]), rows[3]), 0.25);
  const planes = [0, 1, 2, 3].map((i) =>
    inwardPlane(cross(sub(deep((i + 1) % 4), deep(i)), sub(deep(i), near(i))), near(i), inside),
  );
  planes.push(inwardPlane(cross(sub(deep(1), deep(0)), sub(deep(3), deep(0))), near(0), inside));
  return planes;
}

const sphereBehind = (plane: Plane, centre: Vec3, radius: number) =>
  f(dot(plane.n, centre) + plane.w) < -radius;

export function sphereTouchesBox(box: Box, centre: Vec3, radius: number) {
  const clamped = map((a) => Math.max(f(box.lo[a] - centre[a]), f(centre[a] - box.hi[a]), 0));
  return dot(clamped, clamped) <= f(radius * radius);
}

/** `sphereInColumn`: not wholly behind any of the column's planes. */
export const sphereInColumn = (column: Plane[], centre: Vec3, radius: number) =>
  column.every((plane) => !sphereBehind(plane, centre, radius));

/** `depthOf`: the depth the render matrix gives a point of the pass's frame, `w` its divisor. */
export function depthOf(view: TileView, p: Vec3) {
  const r = view.depthRows;
  const row = (o: number) =>
    f(f(f(f(f(r[o]) * p[0]) + f(f(r[o + 1]) * p[1])) + f(f(r[o + 2]) * p[2])) + f(r[o + 3]));
  return { z: row(0), w: row(4) };
}
