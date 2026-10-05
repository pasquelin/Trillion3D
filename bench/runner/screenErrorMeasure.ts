// The screen error of what a backend drew, measured against the source surface, the audit's
// oracle (#959): forward, points of the drawn triangles to the source; reverse, points of the
// source to the drawn triangles. A distance becomes pixels through the cut's own projection
// (`screenErrorBound`, radius zero); the camera, its frustum and its focal length are the
// engine's (`lookAtNode`, `updateCameraFrame`, `pixelScaleOf`), and the nearest-surface queries
// run on the engine's triangle tree.
import type { CameraPose } from '../../packages/sdk-core/src/contracts/base.ts';
import {
  addTransformNode,
  createCameraFrame,
  createTransformTree,
  lookAtNode,
  perspectiveProjection,
  setNodePosition,
  updateCameraFrame,
  updateNodeMatrixWorld,
} from '../../packages/sdk-core/src/math/index.ts';
import { screenErrorBound } from '../../packages/sdk-core/src/lod/screenErrorBound.ts';
import {
  closestSegmentTriangle,
  triangleNormal,
} from '../../packages/sdk-core/src/collision/closest.ts';
import {
  buildTriangleTree,
  type TriangleTree,
} from '../../packages/sdk-core/src/collision/triangleTree.ts';
import {
  forEachTriangleInBox,
  nearestTriangleOnRay,
} from '../../packages/sdk-core/src/collision/triangleQuery.ts';
import { pixelScaleOf } from '../../packages/sdk-browser/src/streaming/priority.ts';

/** Barycentric points sampled on every triangle: corners, edge midpoints, centre and three inner
 *  points. Fixed, so two runs read the same points. */
// prettier-ignore
const SAMPLES = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [0.5, 0.5, 0], [0, 0.5, 0.5], [0.5, 0, 0.5],
  [1 / 3, 1 / 3, 1 / 3], [2 / 3, 1 / 6, 1 / 6], [1 / 6, 2 / 3, 1 / 6], [1 / 6, 1 / 6, 2 / 3]];

/**
 * A point is hidden when a drawn surface stands more than this many pixels before it on its ray.
 * Kept small on purpose: a point counted although a drawn surface stands up to this far before it
 * lies at most this far from that surface, so the margin is the most it can add to the reverse
 * error; a point hidden by more is either truly hidden or, behind a drawn surface that bulges
 * toward the camera, seen by the forward error of that surface.
 */
const HIDDEN_MARGIN_PX = 0.05;
/** Direction of the second visibility ray's aim, off every axis and axis plane. */
const NUDGE = [0.36, 0.8, 0.48];

/** The view one pose gives at `width × height` pixels, read through the engine's camera. */
export function viewOf(pose: CameraPose, width: number, height: number) {
  const tree = createTransformTree(1),
    node = addTransformNode(tree);
  setNodePosition(tree, node, ...pose.position);
  lookAtNode(tree, node, ...pose.target, [0, 1, 0], true);
  updateNodeMatrixWorld(tree, node, true);
  const projection = perspectiveProjection(
    new Float64Array(16),
    pose.fov,
    width / height,
    pose.near,
    1,
  );
  const frame = updateCameraFrame(
    createCameraFrame(),
    projection,
    tree.worldViews[node].slice(),
    pose.far,
  );
  const [fx, fy] = pixelScaleOf(projection, [width, height], [0, 0]);
  return { frame, eye: pose.position, near: pose.near, focal: Math.max(fx, fy) };
}
type View = ReturnType<typeof viewOf>;

const q = new Float64Array(3);
/** Writes `p`'s view coordinates into `q`; false when `p` lies outside the frustum. */
function inView(view: View, p: Float64Array) {
  const { planes, view: m } = view.frame;
  for (let i = 0; i < 24; i += 4)
    if (planes[i] * p[0] + planes[i + 1] * p[1] + planes[i + 2] * p[2] + planes[i + 3] < 0)
      return false;
  for (let r = 0; r < 3; r++) q[r] = m[r] * p[0] + m[r + 4] * p[1] + m[r + 8] * p[2] + m[r + 12];
  return true;
}
/** Pixels a displacement `distance` at the point last read by `inView` moves on screen. */
const pixels = (view: View, distance: number) =>
  screenErrorBound(distance, 1, Math.hypot(q[0], q[1]), -q[2], 0, view.focal, view.near);

const segment = new Float64Array(6),
  closest = new Float64Array(6),
  boxMin = [0, 0, 0],
  boxMax = [0, 0, 0];
/** Distance from `p` to `tree`: a box grown from `start` until it holds the nearest found. */
function nearestDistance(tree: TriangleTree, p: Float64Array, start: number) {
  segment.set(p, 0);
  segment.set(p, 3);
  let best = Infinity;
  const visit = (at: number) => {
    best = Math.min(best, closestSegmentTriangle(closest, segment, tree.triangles, at));
  };
  const scan = (half: number) => {
    for (let k = 0; k < 3; k++) [boxMin[k], boxMax[k]] = [p[k] - half, p[k] + half];
    forEachTriangleInBox(tree, boxMin, boxMax, visit);
    return Math.sqrt(best);
  };
  for (let half = start; ; half *= 4) {
    const found = scan(half);
    if (found <= half || half > 1e9) return found;
    if (found < Infinity) return scan(found);
  }
}

/** Largest value and 99th percentile (not `summarize`: it refuses the infinite errors). */
function summary(values: number[]) {
  const sorted = Float64Array.from(values).sort();
  const at = (share: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))] ?? 0;
  return { points: sorted.length, max: at(1), p99: at(0.99) };
}

/** Every sample point of `triangles` inside the view, with its screen error to `tree`. */
function errors(
  view: View,
  triangles: Float32Array,
  tree: TriangleTree,
  keep: (p: Float64Array, triangle: number) => boolean,
) {
  const out: number[] = [],
    p = new Float64Array(3);
  for (let t = 0; t < triangles.length; t += 9)
    for (const [a, b, c] of SAMPLES) {
      for (let k = 0; k < 3; k++)
        p[k] = a * triangles[t + k] + b * triangles[t + 3 + k] + c * triangles[t + 6 + k];
      if (!inView(view, p) || !keep(p, t / 9)) continue;
      out.push(pixels(view, nearestDistance(tree, p, -q[2] / view.focal)));
    }
  return out;
}

const normal = new Float64Array(3);
/** Whether triangle `t` of `triangles` shows from `eye`: every backend culls a single-sided
 *  triangle seen from behind, a double-sided one (`twoSided[t] === 1`) shows from both sides. */
function shows(triangles: Float32Array, t: number, eye: number[], twoSided?: Uint8Array) {
  if (twoSided?.[t] === 1) return true;
  triangleNormal(normal, triangles, 9 * t);
  let side = 0;
  for (let k = 0; k < 3; k++) side += normal[k] * (eye[k] - triangles[9 * t + k]);
  return side > 0;
}

/**
 * The screen error of `drawn` against `source` under `pose`. Both directions count the sample
 * points in the frustum that no drawn surface hides: what is drawn on screen, and what the
 * source shows through a hole or past a receding drawn surface; the far side of a closed mesh,
 * drawn or not, is not seen. A culled triangle neither hides nor is sampled and cannot satisfy
 * source coverage: a face that turned away leaves a hole, even at a silhouette.
 */
export function measureView(o: {
  source: Float32Array;
  /** Per source triangle, 1 when its material is double-sided; all single-sided if omitted. */
  twoSided?: Uint8Array;
  sourceTree?: TriangleTree;
  drawn: Float32Array;
  /** Per drawn triangle, the same flag. */
  drawnTwoSided?: Uint8Array;
  pose: CameraPose;
  width: number;
  height: number;
}) {
  const view = viewOf(o.pose, o.width, o.height);
  const shown = o.drawn.filter((_, i) => shows(o.drawn, (i / 9) | 0, view.eye, o.drawnTwoSided));
  const sourceTree = o.sourceTree ?? buildTriangleTree(o.source),
    shownTree = buildTriangleTree(shown);
  const ray = new Float64Array(3);
  /** Whether a drawn surface stands before `p` on the ray aimed at `p + nudge`, `nudge` in pixels. */
  const blocked = (p: Float64Array, nudge: number) => {
    const depth = -q[2],
      shift = (nudge * depth) / view.focal;
    for (let k = 0; k < 3; k++) ray[k] = p[k] + shift * NUDGE[k] - view.eye[k];
    const hit = nearestTriangleOnRay(shownTree, view.eye, ray);
    const length = Math.hypot(ray[0], ray[1], ray[2]),
      margin = (HIDDEN_MARGIN_PX * depth) / view.focal;
    return hit !== null && hit.t * length < length - margin;
  };
  // A ray through a shared edge or corner can slip between two drawn triangles; a second ray a
  // hundredth of a pixel aside does not slip through the same crack.
  const visible = (p: Float64Array) => !blocked(p, 0) && !blocked(p, 0.01);
  // A source triangle that does not show is not seen: at a silhouette its points lie on the ray
  // of a surface drawn behind them, on the same pixel. Facing is read once per triangle.
  const faces = Uint8Array.from({ length: o.source.length / 9 }, (_, t) =>
    Number(shows(o.source, t, view.eye, o.twoSided)),
  );
  const forward = errors(view, shown, sourceTree, visible),
    reverse = errors(view, o.source, shownTree, (p, t) => faces[t] === 1 && visible(p));
  return { triangles: o.drawn.length / 9, forward: summary(forward), reverse: summary(reverse) };
}
