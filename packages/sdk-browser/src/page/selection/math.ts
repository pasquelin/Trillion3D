import { projectedErrorAt, viewDepth, viewLateral } from './projection.ts';

export type ClusterCut = {
  lodError?: number;
  level?: number;
  sphere?: number[];
  parentError?: number | null;
  parentSphere?: number[] | null;
  group?: number | null;
  source?: number | null;
};
/** Projected screen error of one (error, object-space sphere) pair, in the frame given by `e`;
 *  `sound` as in `projectedErrorAt`; the sphere grown by `reach`, a deformation's (#357). */
export function projectedClusterError(
  error: number | null | undefined,
  sphere: ArrayLike<number> | null | undefined,
  offset: number,
  e: ArrayLike<number>,
  stretch: number,
  focal: number,
  near: number,
  perspective = 1,
  sound = false,
  reach = 0,
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
    sphere[offset + 3] + reach,
    stretch,
    focal,
    near,
    perspective,
    sound,
  );
}
/**
 * A cluster's own and replacement screen errors, in pixels, written to `out` as `[own, parent]`:
 * what the cut rule compares (`../cut/rule.ts`).
 *
 * A cluster whose parent has no sphere of its own reuses its own: both sides then project the same
 * sphere, so its view distance is taken once and both errors read it, `projectedErrorAt` getting
 * the same operands in the same order as `projectedClusterError`. `sound` as in `projectedErrorAt`;
 * both spheres grow by `reach`. Coarse and replacement errors add twice that reach: by the
 * triangle inequality, arbitrary source displacement cannot separate corresponding points by
 * more than the two displacement bounds. Level-zero vertices need no transfer allowance.
 */
export function clusterPixels(
  rec: ClusterCut,
  e: ArrayLike<number>,
  stretch: number,
  focal: number,
  near: number,
  perspective: number,
  out: Float64Array,
  sound = false,
  reach = 0,
) {
  const sphere = rec.sphere,
    own = (rec.lodError ?? 0) + ((rec.level ?? 0) > 0 ? 2 * reach : 0),
    parent = rec.parentError == null ? rec.parentError : rec.parentError + 2 * reach;
  if (sphere && own !== 0 && own !== Infinity && rec.parentSphere == null) {
    const lateral = viewLateral(sphere, 0, e),
      depth = viewDepth(sphere, 0, e),
      radius = sphere[3] + reach;
    out[0] = projectedErrorAt(
      own,
      lateral,
      depth,
      radius,
      stretch,
      focal,
      near,
      perspective,
      sound,
    );
    out[1] = projectedErrorAt(
      parent,
      lateral,
      depth,
      radius,
      stretch,
      focal,
      near,
      perspective,
      sound,
    );
    return out;
  }
  out[0] = projectedClusterError(
    own,
    sphere,
    0,
    e,
    stretch,
    focal,
    near,
    perspective,
    sound,
    reach,
  );
  out[1] = projectedClusterError(
    parent,
    rec.parentSphere ?? sphere,
    0,
    e,
    stretch,
    focal,
    near,
    perspective,
    sound,
    reach,
  );
  return out;
}
