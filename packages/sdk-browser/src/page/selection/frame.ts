import { clusterPixels, projectedClusterError } from './math.ts';
import type { PageRecord, SelectionState } from '../cut/state.ts';

/** `clusterPixels` through the frame's own lens — its view, stretch, focal length, near plane and
 *  projection — into `out`. */
export function framePixels<T extends PageRecord>(s: SelectionState<T>, rec: T, out: Float64Array) {
  const { flatElements, flatStretch, flatFocal, cam } = s;
  return clusterPixels(rec, flatElements, flatStretch, flatFocal, cam.near, cam.perspective, out);
}

/** `projectedClusterError` of one (error, sphere at `offset`) pair through the frame's lens. */
export function frameClusterError<T extends PageRecord>(
  s: SelectionState<T>,
  error: number | null | undefined,
  sphere: ArrayLike<number> | null | undefined,
  offset = 0,
) {
  const { flatElements, flatStretch, flatFocal, cam } = s;
  const { near, perspective } = cam;
  return projectedClusterError(
    error,
    sphere,
    offset,
    flatElements,
    flatStretch,
    flatFocal,
    near,
    perspective,
  );
}
