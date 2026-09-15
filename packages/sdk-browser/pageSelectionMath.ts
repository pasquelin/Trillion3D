import { clusterErrorAtDistance } from '../sdk-core/index.ts';
import { viewDistance } from './pageSelectionProjection.ts';

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
) {
  // Exact geometry and clusters with no replacement need no projection at all, which is most of them.
  if (error === 0) return 0;
  if (error == null || error === Infinity) return Infinity;
  if (!sphere) return Infinity;
  return clusterErrorAtDistance(
    error,
    stretch,
    viewDistance(sphere, offset, e),
    sphere[offset + 3],
    focal,
    near,
  );
}
export function cutSelects(
  rec: ClusterCut,
  e: ArrayLike<number>,
  stretch: number,
  focal: number,
  near: number,
  pixelError: number,
) {
  if (projectedClusterError(rec.lodError ?? 0, rec.sphere, 0, e, stretch, focal, near) > pixelError)
    return false;
  return (
    projectedClusterError(
      rec.parentError,
      rec.parentSphere ?? rec.sphere,
      0,
      e,
      stretch,
      focal,
      near,
    ) > pixelError
  );
}
