// The cameras of the screen-error measure (#959). `orbit` and `terrain` are the audit's
// (`preuves/CMP/scripts/dagsim.py`, `cameras`), placed from the source's own box: three angles
// at 1.2, 2, 5 and 20 radii around an object, and a terrain seen from the ground, the air and
// afar. `bench` is the bench's four named views (`poses.ts`, `VIEWS`), read off the engine's box.
import type { CameraPose } from '../../packages/sdk-core/src/contracts/base.ts';
import type { TriangleTree } from '../../packages/sdk-core/src/collision/triangleTree.ts';
import { VIEWS, poseAt, type Bounds } from './poses.ts';

export const POSE_SETS = ['orbit', 'terrain', 'bench'] as const;
export type PoseSet = (typeof POSE_SETS)[number];
export interface NamedPose {
  view: string;
  pose: CameraPose;
}

const ANGLES = [0, (2 * Math.PI) / 3, (4 * Math.PI) / 3];
const FOV = 55;

/** Height of the source corner nearest to `(x, z)` in plan: the ground a walker stands on. */
function groundAt(triangles: Float32Array, x: number, z: number) {
  let best = Infinity,
    y = 0;
  for (let i = 0; i < triangles.length; i += 3) {
    const d = (triangles[i] - x) ** 2 + (triangles[i + 2] - z) ** 2;
    if (d < best) [best, y] = [d, triangles[i + 1]];
  }
  return y;
}

type Vec = [number, number, number];

const ORBIT_RADII = [1.2, 2, 5, 20];

/** The audit's cameras around `source`, world-space triangles whose engine tree is `tree` (its
 *  root node's bounds are the source's box). */
export function auditPoses(
  set: 'orbit' | 'terrain',
  source: Float32Array,
  tree: TriangleTree,
): NamedPose[] {
  const lo = tree.bounds.subarray(0, 3),
    hi = tree.bounds.subarray(3, 6);
  const c: Vec = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
  const radius = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 2;
  const near = Math.max(radius / 10000, 0.01),
    far = set === 'terrain' ? Math.max(radius * 20, 4000) : radius * 40;
  const at = (view: string, position: Vec, target: Vec) => ({
    view,
    pose: { position, target, fov: FOV, near, far },
  });
  const poses: NamedPose[] = [];
  const name = (kind: string, a: number) => `${kind}-a${a.toFixed(2)}`;
  if (set === 'orbit') {
    for (const k of ORBIT_RADII)
      for (const a of ANGLES) {
        const d = radius * k;
        const eye: Vec = [c[0] + d * Math.cos(a), c[1] + d * 0.35, c[2] + d * Math.sin(a)];
        poses.push(at(name(`d${k}`, a), eye, c));
      }
    return poses;
  }
  const plan = (a: number) => [
    c[0] + (hi[0] - lo[0]) * 0.45 * Math.cos(a),
    c[2] + (hi[2] - lo[2]) * 0.45 * Math.sin(a),
  ];
  for (const a of ANGLES) {
    const [x, z] = plan(a),
      eye = groundAt(source, x, z) + 1.8;
    poses.push(at(name('ground', a), [x, eye, z], [c[0], eye, c[2]]));
  }
  for (const a of ANGLES) {
    const [x, z] = plan(a);
    poses.push(at(name('air', a), [x, hi[1] + 150, z], c));
  }
  for (const a of ANGLES)
    poses.push(
      at(name('far', a), [c[0] + 3000 * Math.cos(a), c[1] + 300, c[2] + 3000 * Math.sin(a)], c),
    );
  return poses;
}

/** The bench's named views of a model whose engine box is `bounds`. */
export const benchPoses = (bounds: Bounds): NamedPose[] =>
  Object.entries(VIEWS).map(([view, { index }]) => ({ view, pose: poseAt(bounds, index) }));
