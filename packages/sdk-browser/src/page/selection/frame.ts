import { cutSelects, projectedClusterError } from './math.ts';
import type { PageRecord, SelectionState } from '../cut/state.ts';

/** `cutSelects` through the frame's own lens — its view, stretch, focal length, near plane and
 *  projection — against `threshold`. */
export function frameSelects<T extends PageRecord>(
  s: SelectionState<T>,
  rec: T,
  threshold: number,
) {
  const { flatElements, flatStretch, flatFocal, cam } = s;
  return cutSelects(
    rec,
    flatElements,
    flatStretch,
    flatFocal,
    cam.near,
    threshold,
    cam.perspective,
  );
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
