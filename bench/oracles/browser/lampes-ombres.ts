// Lamp-shadow oracles, rewritten from the contracts: the world-space sphere of a cluster —
// transformed box centre, radius inflated term by term, written in f32 at its place as the
// pass does — and a lamp's screen coverage, square of its apparent angle over the half-field.
import type { ShadowViewpoint } from '../../../packages/sdk-core/index.ts';
import type { PageRec } from '../../../packages/sdk-browser/pageSelectionTypes.ts';

export function referenceClusterSphere(
  { matrix: { elements: e }, min, max }: Pick<PageRec, 'matrix' | 'min' | 'max'>,
  out: Float32Array,
  base: number,
) {
  const mx = (min[0] + max[0]) / 2,
    my = (min[1] + max[1]) / 2,
    mz = (min[2] + max[2]) / 2;
  const hx = (max[0] - min[0]) / 2,
    hy = (max[1] - min[1]) / 2,
    hz = (max[2] - min[2]) / 2;
  out[base] = e[0] * mx + e[4] * my + e[8] * mz + e[12];
  out[base + 1] = e[1] * mx + e[5] * my + e[9] * mz + e[13];
  out[base + 2] = e[2] * mx + e[6] * my + e[10] * mz + e[14];
  out[base + 3] = Math.hypot(
    Math.abs(e[0]) * hx + Math.abs(e[4]) * hy + Math.abs(e[8]) * hz,
    Math.abs(e[1]) * hx + Math.abs(e[5]) * hy + Math.abs(e[9]) * hz,
    Math.abs(e[2]) * hx + Math.abs(e[6]) * hy + Math.abs(e[10]) * hz,
  );
}

export function referenceScreenCoverage(
  view: ShadowViewpoint,
  x: number,
  y: number,
  z: number,
  range: number,
) {
  const dx = x - view.position[0],
    dy = y - view.position[1],
    dz = z - view.position[2];
  const distance = Math.hypot(dx, dy, dz);
  const ahead = dx * view.forward[0] + dy * view.forward[1] + dz * view.forward[2];
  if (ahead + range < 0 || distance - range > view.far) return 0;
  const ratio = Math.atan(range / Math.max(distance, 1e-3)) / view.halfFovY;
  return Math.min(1, ratio * ratio);
}
