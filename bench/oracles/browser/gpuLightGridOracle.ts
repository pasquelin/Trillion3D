/**
 * Oracle of the light grid's cells (#1369), a line-by-line port of
 * packages/sdk-browser/src/lighting/tiles/{boundsWgsl,shader}.ts, every operation rounded to f32:
 * a column's planes, a light's span of depth slices, a cell's bounds and the test of a light's
 * range sphere against them. `inverseViewProjection` is column-major and maps to the frame of
 * `origin` (`tileViewInverse`), where points are given (`toTileFrame`); `depthRows` are the render
 * matrix's depth and w rows in that frame (`tileDepthRows`).
 */
import { LIGHT_SETTINGS } from '../../../packages/sdk-core/src/index.ts';
import { DEPTH_NEAR } from '../../../packages/sdk-browser/src/camera/depthConvention.ts';

type Vec3 = [number, number, number];
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
/** `SLICE_PAD`: the relative margin a cell's depth range is widened by on each side. */
export const SLICE_PAD = 1 / 256;

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
  Math.trunc(Math.min(Math.max(f(-f(Math.log2(Math.max(z, 1e-30))) * grid.perOctave), 0), grid.slices - 1));

/** `sliceDepths`: the depth of a slice's front and back, each widened by `SLICE_PAD`; the near
 *  plane in front of the first, nothing behind the last (0: the background). */
export function sliceDepths(slice: number, grid = GRID) {
  const at = (s: number) => f(2 ** f(-s / grid.perOctave));
  const front = slice === 0 ? DEPTH_NEAR : f(at(slice) * f(1 + SLICE_PAD));
  const back = slice === grid.slices - 1 ? 0 : f(at(slice + 1) * f(1 - SLICE_PAD));
  return { front, back };
}

export function cellCorner(view: TileView, cell: [number, number], corner: number, z: number, grid = GRID) {
  const edge = (t: number, far: number, extent: number) =>
    far ? Math.min(f(((t + 1) * grid.cell) / extent), 1) : f((t * grid.cell) / extent);
  const x = edge(cell[0], corner & 1, view.width);
  const y = edge(cell[1], corner & 2, view.height);
  return unproject(view.inverseViewProjection, f(f(x * 2) - 1), f(1 - f(y * 2)), f(z));
}

/** The box of a set of points: the min and max of each axis. */
export const boxOf = (points: Vec3[]): Box => ({
  lo: map((a) => Math.min(...points.map((p) => p[a]))),
  hi: map((a) => Math.max(...points.map((p) => p[a]))),
});

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

/** `sphereInColumn`: within the four sides and past the near plane. */
export const sphereInColumn = (column: Plane[], centre: Vec3, radius: number) =>
  column.every((plane) => !sphereBehind(plane, centre, radius));

/** `depthOf`: the depth the render matrix gives a point of the pass's frame, `w` its divisor. */
function depthOf(view: TileView, p: Vec3) {
  const r = view.depthRows;
  const row = (o: number) =>
    f(f(f(f(f(r[o]) * p[0]) + f(f(r[o + 1]) * p[1])) + f(f(r[o + 2]) * p[2])) + f(r[o + 3]));
  return { z: row(0), w: row(4) };
}

/** `sliceSpan`: the slices a sphere's view depths fall in, one more on each side. */
export function sliceSpan(view: TileView, column: Plane[], centre: Vec3, radius: number, grid = GRID) {
  const away = column[4].n;
  const front = depthOf(view, sub(centre, scale(away, radius)));
  const back = depthOf(view, add(centre, scale(away, radius)));
  const first = front.w > 0 ? gridSlice(f(front.z / front.w), grid) : 0;
  const last = back.w > 0 ? gridSlice(f(back.z / back.w), grid) : grid.slices - 1;
  return [Math.max(first, 1) - 1, Math.min(last + 1, grid.slices - 1)];
}

/** `cellBounds`: a cell's front and back planes, parallel to the near one, and its box. */
export function cellBounds(view: TileView, cell: [number, number], slice: number, column: Plane[], grid = GRID) {
  const { front, back } = sliceDepths(slice, grid);
  const corners = [0, 1, 2, 3, 4, 5, 6, 7].map((c) =>
    cellCorner(view, cell, c & 3, c & 4 ? back : front, grid),
  );
  const away = column[4].n;
  return {
    front: { n: away, w: -dot(away, corners[0]) } as Plane,
    back: { n: scale(away, -1), w: dot(away, corners[4]) } as Plane,
    box: boxOf(corners),
    last: slice === grid.slices - 1,
  };
}

/** `cellHit`: a sphere already in the column touches the cell's slab and box; the last slice is
 *  unbounded behind, the column's alone. */
export function cellHit(bounds: ReturnType<typeof cellBounds>, centre: Vec3, radius: number) {
  if (sphereBehind(bounds.front, centre, radius)) return false;
  if (bounds.last) return true;
  return !sphereBehind(bounds.back, centre, radius) && sphereTouchesBox(bounds.box, centre, radius);
}

/** `columnFrame`: the column's axes — across, down, into the view — and, along each lateral
 *  axis, its low and high edge as `edge + slope · t`, `t` the depth along the view axis, read from
 *  its corners at the near plane and at the column's deep row. */
export function columnFrame(view: TileView, cell: [number, number], column: Plane[], grid = GRID) {
  const near = [0, 1, 2, 3].map((c) => cellCorner(view, cell, c, DEPTH_NEAR, grid));
  const deep = [0, 1, 2, 3].map((c) => cellCorner(view, cell, c, DEPTH_NEAR / 1024, grid));
  const into = column[4].n;
  const unit = (v: Vec3) => scale(v, f(1 / f(Math.sqrt(dot(v, v)))));
  const across = unit(sub(deep[1], deep[0]));
  const down = unit(sub(deep[2], deep[0]));
  const [tn, td] = [dot(into, near[0]), dot(into, deep[0])];
  const edge = (axis: Vec3, low: boolean, a: number, b: number) => {
    const pick = (row: Vec3[]) => (low ? Math.min : Math.max)(dot(axis, row[a]), dot(axis, row[b]));
    const slope = f(f(pick(deep) - pick(near)) / f(td - tn));
    return { at: f(pick(near) - f(slope * tn)), slope };
  };
  return {
    axes: [across, down, into] as const,
    edges: [edge(across, true, 0, 2), edge(across, false, 1, 3), edge(down, true, 0, 1), edge(down, false, 2, 3)],
    tn,
  };
}

/** `NEWTON_STEPS`: the steps each end of a light's run takes toward the sphere. */
export const NEWTON_STEPS = 4;

/** `lightRun`: the run of slices a sphere may meet in the column, `null` for none. At depth `t`
 *  along the view axis the column's section is a rectangle whose edges are linear in `t`; the
 *  squared distance from the centre to it, `f(t)`, is convex, and the sphere meets the section
 *  where `f(t) ≤ r²`: an interval. Newton's steps on a convex function never pass its root, so
 *  each end, stepped from the sphere's own depth extent, stays outside the interval: the run holds
 *  every slice the sphere meets, one slice more on each side. */
export function lightRun(view: TileView, frame: ReturnType<typeof columnFrame>, centre: Vec3, radius: number, grid = GRID) {
  const [across, down, into] = frame.axes;
  const r = f(radius * 1.001);
  const ct = dot(into, centre);
  const c = [dot(across, centre), dot(down, centre)];
  const R = f(r * r);
  /** f(t) and f'(t). */
  const fd = (t: number) => {
    let value = f(f(t - ct) * f(t - ct)),
      slope = f(2 * f(t - ct));
    for (let axis = 0; axis < 2; axis++) {
      const [low, high] = [frame.edges[2 * axis], frame.edges[2 * axis + 1]];
      const under = f(f(low.at + f(low.slope * t)) - c[axis]);
      const over = f(c[axis] - f(high.at + f(high.slope * t)));
      if (under > 0) {
        value = f(value + f(under * under));
        slope = f(slope + f(2 * f(under * low.slope)));
      } else if (over > 0) {
        value = f(value + f(over * over));
        slope = f(slope - f(2 * f(over * high.slope)));
      }
    }
    return { value, slope };
  };
  let lo = Math.max(f(ct - r), frame.tn),
    hi = f(ct + r);
  if (!(lo <= hi)) return null;
  for (let step = 0; step < NEWTON_STEPS; step++) {
    const at = fd(lo);
    if (at.value <= R) break;
    // Past the minimum, still above r²: the sphere misses the section at every depth.
    if (at.slope >= 0) return null;
    lo = f(lo + f(f(R - at.value) / at.slope));
  }
  for (let step = 0; step < NEWTON_STEPS; step++) {
    const at = fd(hi);
    if (at.value <= R) break;
    if (at.slope <= 0) return null;
    hi = f(hi + f(f(R - at.value) / at.slope));
  }
  if (!(lo <= hi)) return null;
  // A depth a thousandth nearer at the front, farther at the back: never the neighbour's slice by
  // a rounding of the depth the pixel reads.
  const sliceAt = (t: number, margin: number) => {
    const d = depthOf(view, add(centre, scale(into, f(t - ct))));
    return d.w > 0 ? gridSlice(f(f(d.z / d.w) * margin), grid) : 0;
  };
  return [sliceAt(lo, RUN_MARGIN[0]), sliceAt(hi, RUN_MARGIN[1])];
}
/** `RUN_MARGIN`: the factors a run's front and back depth are widened by. */
export const RUN_MARGIN = [f(1 + 1 / 1024), f(1 - 1 / 1024)];
