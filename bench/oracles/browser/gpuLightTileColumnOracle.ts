/**
 * Oracle of a tile's world bounds, a line-by-line port of `tileCorner`, `tileBox`,
 * `inwardPlane`, `tileColumn`, `tileSlab` and the sphere tests in
 * packages/sdk-browser/src/lighting/tiles/{shader,boundsWgsl}.ts. Every operation is rounded to
 * f32 as the shader's is; `inverseViewProjection` is column-major, like the uniform; depth is
 * reversed with an infinite far plane.
 */
import { LIGHT_SETTINGS } from '../../../packages/sdk-core/src/index.ts';
import { DEPTH_NEAR } from '../../../packages/sdk-browser/src/camera/depthConvention.ts';

type Vec3 = [number, number, number];
export type TileView = { inverseViewProjection: ArrayLike<number>; width: number; height: number };
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

function unproject(m: ArrayLike<number>, x: number, y: number, z: number): Vec3 {
  const row = (r: number) =>
    f(f(f(f(m[r] * x) + f(m[r + 4] * y)) + f(m[r + 8] * z)) + f(m[r + 12]));
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

export function tileBox(view: TileView, tile: [number, number], front: number, back: number) {
  const corners = [...Array(8).keys()].map((c) =>
    tileCorner(view, tile, c & 3, c & 4 ? back : front),
  );
  return {
    lo: map((a) => Math.min(...corners.map((p) => p[a]))),
    hi: map((a) => Math.max(...corners.map((p) => p[a]))),
  };
}

function inwardPlane(normal: Vec3, point: Vec3, inside: Vec3): Plane {
  const n = scale(normal, f(1 / f(Math.sqrt(dot(normal, normal)))));
  const facing = dot(n, sub(inside, point)) >= 0 ? n : scale(n, -1);
  return { n: facing, w: -dot(facing, point) };
}

export function tileColumn(view: TileView, tile: [number, number]) {
  const order = [0, 1, 3, 2];
  const near = order.map((c) => tileCorner(view, tile, c, DEPTH_NEAR));
  const deep = order.map((c) => tileCorner(view, tile, c, DEPTH_NEAR / 1024));
  const inside = deep.reduce((s, p) => add(s, scale(p, 0.25)), [0, 0, 0] as Vec3);
  const planes = order.map((_, i) =>
    inwardPlane(cross(sub(deep[(i + 1) % 4], deep[i]), sub(deep[i], near[i])), near[i], inside),
  );
  planes.push(inwardPlane(cross(sub(deep[1], deep[0]), sub(deep[3], deep[0])), near[0], inside));
  return planes;
}

/** The opaque slice's front and back planes, oriented by the column's near plane. */
export function tileSlab(
  view: TileView,
  tile: [number, number],
  column: Plane[],
  front: number,
  back: number,
) {
  const away = column[4].n;
  const plane = (z: number, toward: Vec3) => {
    const [p0, p1, p2] = [0, 1, 2].map((c) => tileCorner(view, tile, c, z));
    return inwardPlane(cross(sub(p1, p0), sub(p2, p0)), p0, add(p0, toward));
  };
  return [plane(front, away), plane(back, scale(away, -1))];
}

export function sphereTouchesBox(box: Box, centre: Vec3, radius: number) {
  const clamped = map((a) => Math.max(f(box.lo[a] - centre[a]), f(centre[a] - box.hi[a]), 0));
  return dot(clamped, clamped) <= f(radius * radius);
}

export function sphereTouchesColumn(column: Plane[], centre: Vec3, radius: number) {
  return column.every((plane) => f(dot(plane.n, centre) + plane.w) >= -radius);
}

export function sphereInFront(plane: Plane, centre: Vec3, radius: number) {
  const side = dot(plane.n, centre);
  const margin = f(f(radius + f(1e-5 * f(Math.abs(side) + Math.abs(plane.w)))) + f(1e-4));
  return f(side + plane.w) >= -margin;
}

const inSides = (column: Plane[], centre: Vec3, radius: number) =>
  column.slice(0, 4).every((plane) => sphereInFront(plane, centre, radius));

export function sphereTouchesOpaqueSlice(bounds: TileBounds, centre: Vec3, radius: number) {
  const { opaqueBox, column, slab } = bounds;
  return (
    sphereTouchesBox(opaqueBox, centre, radius) &&
    inSides(column, centre, radius) &&
    sphereInFront(slab[0], centre, radius) &&
    sphereInFront(slab[1], centre, radius)
  );
}

export function sphereTouchesBlendSlice(bounds: TileBounds, centre: Vec3, radius: number) {
  const { blendBox, column, slab } = bounds;
  return (
    sphereTouchesBox(blendBox, centre, radius) &&
    inSides(column, centre, radius) &&
    sphereInFront(column[4], centre, radius) &&
    sphereInFront(slab[1], centre, radius)
  );
}

export type TileBounds = { opaqueBox: Box; blendBox: Box; column: Plane[]; slab: Plane[] };

/** What thread zero builds for a tile whose opaque pixels span `front` to `back`, no sky pixel. */
export function tileBounds(view: TileView, tile: [number, number], front: number, back: number) {
  const column = tileColumn(view, tile);
  return {
    opaqueBox: tileBox(view, tile, front, back),
    blendBox: tileBox(view, tile, DEPTH_NEAR, back),
    column,
    slab: tileSlab(view, tile, column, front, back),
  };
}
