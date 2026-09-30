// The run of a column's slices a light's range sphere meets (#1369): `columnFrame` and `lightRun`
// of packages/sdk-browser/src/lighting/tiles/boundsWgsl.ts, ported line by line in f32 beside the
// column's oracle (`gpuLightGridOracle.ts`).
import { DEPTH_NEAR } from '../../../packages/sdk-browser/src/camera/depthConvention.ts';
import {
  GRID,
  add,
  cellCorner,
  depthOf,
  dot,
  f,
  gridSlice,
  scale,
  sub,
  type Plane,
  type TileView,
  type Vec3,
} from './gpuLightGridOracle.ts';

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
    // Left, right, top, bottom: the lower or higher of the edge's two corners.
    edges: [
      [across, true, 0, 2],
      [across, false, 1, 3],
      [down, true, 0, 1],
      [down, false, 2, 3],
    ].map(([axis, low, a, b]) => edge(axis as Vec3, low as boolean, a as number, b as number)),
    tn,
  };
}

/** `NEWTON_STEPS`: the steps each end of a light's run takes toward the sphere. */
export const NEWTON_STEPS = 4;
/** `RUN_FRONT`, `RUN_BACK`: the factors a run's front and back depth are widened by. */
export const RUN_MARGIN = [f(1 + 1 / 1024), f(1 - 1 / 1024)];

/** `lightRun`: the run of slices a sphere may meet in the column, `null` for none. At depth `t`
 *  along the view axis the column's section is a rectangle whose edges are linear in `t`; the
 *  squared distance from the centre to it, `f(t)`, is convex, and the sphere meets the section
 *  where `f(t) ≤ r²`: an interval. Newton's steps on a convex function never pass its root, so
 *  each end, stepped from the sphere's own depth extent, stays outside the interval: the run holds
 *  every slice the sphere meets. */
export function lightRun(
  view: TileView,
  frame: ReturnType<typeof columnFrame>,
  centre: Vec3,
  radius: number,
  grid = GRID,
) {
  if (!(radius > 0)) return null;
  if (radius > 3e38) return [0, grid.slices - 1];
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
