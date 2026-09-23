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
export function cutSelects(
  rec: ClusterCut,
  e: ArrayLike<number>,
  stretch: number,
  focal: number,
  near: number,
  pixelError: number,
  perspective = 1,
) {
  const sphere = rec.sphere,
    own = rec.lodError ?? 0,
    parent = rec.parentError;
  // A cluster whose parent has no sphere of its own reuses its own: both sides of the test
  // then projected the same sphere twice, hence four square roots per record instead of two.
  // One projection, shared the way `nodeDecision` already shares its own;
  // `projectedErrorAt` gets the same operands in the same order as `projectedClusterError`.
  if (sphere && own !== 0 && own !== Infinity && rec.parentSphere == null) {
    const lateral = viewLateral(sphere, 0, e),
      depth = viewDepth(sphere, 0, e),
      radius = sphere[3];
    if (
      projectedErrorAt(own, lateral, depth, radius, stretch, focal, near, perspective) > pixelError
    )
      return false;
    return (
      projectedErrorAt(parent, lateral, depth, radius, stretch, focal, near, perspective) >
      pixelError
    );
  }
  if (projectedClusterError(own, sphere, 0, e, stretch, focal, near, perspective) > pixelError)
    return false;
  const parentSphere = rec.parentSphere ?? sphere;
  return (
    projectedClusterError(parent, parentSphere, 0, e, stretch, focal, near, perspective) >
    pixelError
  );
}
