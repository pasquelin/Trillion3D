// The cameras of the screen-error measure (#959). `orbit` and `terrain` are the audit's
// (`preuves/CMP/scripts/dagsim.py`, `cameras`), placed from the source's own box: three angles
// at 1.2, 2, 5 and 20 radii around an object, and a terrain seen from the ground, the air and
// afar. `bench` is the bench's four named views (`poses.ts`, `VIEWS`), read off the engine's box.
import type { CameraPose } from '../../packages/sdk-core/src/contracts/base.ts';
import { VIEWS, poseAt, type Bounds } from './poses.ts';

export type PoseSet = 'orbit' | 'terrain' | 'bench';
export interface NamedPose {
  view: string;
  pose: CameraPose;
}

const ANGLES = [0, (2 * Math.PI) / 3, (4 * Math.PI) / 3];
const FOV = 55;

/** Box of a triangle list, nine numbers per triangle. */
function boxOf(triangles: Float32Array) {
  const lo = [Infinity, Infinity, Infinity],
    hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < triangles.length; i++) {
    lo[i % 3] = Math.min(lo[i % 3], triangles[i]);
    hi[i % 3] = Math.max(hi[i % 3], triangles[i]);
  }
  return { lo, hi };
}

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

/** The audit's cameras around `source`, world-space triangles. */
export function auditPoses(set: 'orbit' | 'terrain', source: Float32Array): NamedPose[] {
  const { lo, hi } = boxOf(source);
  const c: Vec = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
  const radius = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 2;
  const near = Math.max(radius / 10000, 0.01),
    far = set === 'terrain' ? Math.max(radius * 20, 4000) : radius * 40;
  const at = (view: string, position: Vec, target: Vec) => ({
    view,
    pose: { position, target, fov: FOV, near, far },
  });
  const poses: NamedPose[] = [];
  const kinds = set === 'terrain' ? ['ground', 'air', 'far'] : ['d1.2', 'd2', 'd5', 'd20'];
  for (const kind of kinds)
    for (const a of ANGLES) {
      const view = `${kind}-a${a.toFixed(2)}`,
        cos = Math.cos(a),
        sin = Math.sin(a);
      if (set === 'orbit') {
        const k = radius * Number(kind.slice(1));
        poses.push(at(view, [c[0] + k * cos, c[1] + k * 0.35, c[2] + k * sin], c));
        continue;
      }
      const x = c[0] + (hi[0] - lo[0]) * 0.45 * cos,
        z = c[2] + (hi[2] - lo[2]) * 0.45 * sin;
      if (kind === 'air') poses.push(at(view, [x, hi[1] + 150, z], c));
      else if (kind === 'far')
        poses.push(at(view, [c[0] + 3000 * cos, c[1] + 300, c[2] + 3000 * sin], c));
      else {
        const eye = groundAt(source, x, z) + 1.8;
        poses.push(at(view, [x, eye, z], [c[0], eye, c[2]]));
      }
    }
  return poses;
}

/** The bench's named views of a model whose engine box is `bounds`. */
export const benchPoses = (bounds: Bounds): NamedPose[] =>
  Object.entries(VIEWS).map(([view, { index }]) => ({ view, pose: poseAt(bounds, index) }));
