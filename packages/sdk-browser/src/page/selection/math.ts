import { projectedErrorAt, viewDepth, viewLateral } from './projection.ts';

export type ClusterCut = {
  lodError?: number;
  sphere?: number[];
  parentError?: number | null;
  parentSphere?: number[] | null;
  group?: number | null;
  source?: number | null;
};
/** Projected screen error of one (error, object-space sphere) pair, in the frame given by `e`. */
export function projectedClusterError(
  error: number | null | undefined,
  sphere: ArrayLike<number> | null | undefined,
  offset: number,
  e: ArrayLike<number>,
  stretch: number,
  focal: number,
  near: number,
  perspective = 1,
) {
  // One extra guard over `projectedErrorAt`, which is left the projection: a missing sphere.
  // The other two stay here, before the projection's two square roots, because the most common
  // cut case is precisely a cluster with zero error.
  if (error === 0) return 0;
  if (error == null || error === Infinity || !sphere) return Infinity;
  return projectedErrorAt(
    error,
    viewLateral(sphere, offset, e),
    viewDepth(sphere, offset, e),
    sphere[offset + 3],
    stretch,
    focal,
    near,
    perspective,
  );
}
/**
 * A cluster's own and replacement screen errors, in pixels, written to `out` as `[own, parent]`:
 * what the cut rule compares (`../cut/rule.ts`).
 *
 * A cluster whose parent has no sphere of its own reuses its own: both sides then project the same
 * sphere, so its view distance is taken once and both errors read it, `projectedErrorAt` getting
 * the same operands in the same order as `projectedClusterError`.
 */
export function clusterPixels(
  rec: ClusterCut,
  e: ArrayLike<number>,
  stretch: number,
  focal: number,
  near: number,
  perspective: number,
  out: Float64Array,
) {
  const sphere = rec.sphere,
    own = rec.lodError ?? 0,
    parent = rec.parentError;
  if (sphere && own !== 0 && own !== Infinity && rec.parentSphere == null) {
    const lateral = viewLateral(sphere, 0, e),
      depth = viewDepth(sphere, 0, e),
      radius = sphere[3];
    out[0] = projectedErrorAt(own, lateral, depth, radius, stretch, focal, near, perspective);
    out[1] = projectedErrorAt(parent, lateral, depth, radius, stretch, focal, near, perspective);
    return out;
  }
  out[0] = projectedClusterError(own, sphere, 0, e, stretch, focal, near, perspective);
  out[1] = projectedClusterError(
    parent,
    rec.parentSphere ?? sphere,
    0,
    e,
    stretch,
    focal,
    near,
    perspective,
  );
  return out;
}
