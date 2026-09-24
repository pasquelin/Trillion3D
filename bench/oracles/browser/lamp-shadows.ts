// Lamp-shadow oracle, rewritten from the contracts: the world-space sphere of a cluster —
// transformed box centre, radius inflated term by term, written in f32 at its place as the
// pass does.
import type { PageRec } from '../../../packages/sdk-browser/src/page/selection/types.ts';

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
