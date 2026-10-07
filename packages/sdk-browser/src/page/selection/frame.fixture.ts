import { projectedClusterError, type ClusterCut } from './math.ts'
import { projectedErrorAt, viewDepth, viewLateral } from './projection.ts'
import type { PageRecord, SelectionState } from '../cut/state.fixture.ts'

/** `clusterPixels` through the frame's own lens — its view, stretch, focal length, near plane and
 *  projection, checked once per root (`flatSound`) — into `out`. */
export function framePixels<T extends PageRecord>(s: SelectionState<T>, rec: T, out: Float64Array) {
  const { flatElements, flatStretch, flatFocal, cam, flatSound, flatReach } = s
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
  )
}

/** `projectedClusterError` of one (error, sphere at `offset`) pair through the frame's lens. */
export function frameClusterError<T extends PageRecord>(
  s: SelectionState<T>,
  error: number | null | undefined,
  sphere: ArrayLike<number> | null | undefined,
  offset = 0,
) {
  const { flatElements, flatStretch, flatFocal, cam, flatSound, flatReach } = s
  const { near, perspective } = cam
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
  )
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
    parent = rec.parentError == null ? rec.parentError : rec.parentError + 2 * reach
  if (sphere && own !== 0 && own !== Infinity && rec.parentSphere == null) {
    const lateral = viewLateral(sphere, 0, e),
      depth = viewDepth(sphere, 0, e),
      radius = sphere[3] + reach
    out[0] = projectedErrorAt(own, lateral, depth, radius, stretch, focal, near, perspective, sound)
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
    )
    return out
  }
  out[0] = projectedClusterError(own, sphere, 0, e, stretch, focal, near, perspective, sound, reach)
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
  )
  return out
}
