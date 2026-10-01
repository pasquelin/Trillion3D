import { clusterPixels, projectedClusterError } from './math.ts';
import type { PageRecord, SelectionState } from '../cut/state.ts';

/** `clusterPixels` through the frame's own lens — its view, stretch, focal length, near plane and
 *  projection, checked once per root (`flatSound`) — into `out`. */
export function framePixels<T extends PageRecord>(s: SelectionState<T>, rec: T, out: Float64Array) {
  const { flatElements, flatStretch, flatFocal, cam, flatSound, flatReach } = s;
  if (s.lenses) {
    let own = 0,
      parent = 0;
    for (const lens of s.lenses) {
      clusterPixels(
        rec,
        lens.matrix,
        lens.stretch,
        lens.focal,
        lens.camera.near,
        lens.camera.perspective,
        out,
        lens.sound,
        flatReach,
      );
      own = Math.max(own, out[0]);
      parent = Math.max(parent, out[1]);
    }
    out[0] = own;
    out[1] = parent;
    return out;
  }
  return clusterPixels(
    rec,
    flatElements,
    flatStretch,
    flatFocal,
    cam.near,
    cam.perspective,
    out,
    flatSound,
    flatReach,
  );
}

/** `projectedClusterError` of one (error, sphere at `offset`) pair through the frame's lens. */
export function frameClusterError<T extends PageRecord>(
  s: SelectionState<T>,
  error: number | null | undefined,
  sphere: ArrayLike<number> | null | undefined,
  offset = 0,
) {
  const { flatElements, flatStretch, flatFocal, cam, flatSound, flatReach } = s;
  const { near, perspective } = cam;
  if (s.lenses) {
    let maximum = 0;
    for (const lens of s.lenses)
      maximum = Math.max(
        maximum,
        projectedClusterError(
          error,
          sphere,
          offset,
          lens.matrix,
          lens.stretch,
          lens.focal,
          lens.camera.near,
          lens.camera.perspective,
          lens.sound,
          flatReach,
        ),
      );
    return maximum;
  }
  return projectedClusterError(
    error,
    sphere,
    offset,
    flatElements,
    flatStretch,
    flatFocal,
    near,
    perspective,
    flatSound,
    flatReach,
  );
}
