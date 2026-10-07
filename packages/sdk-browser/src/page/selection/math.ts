import { projectedErrorAt, viewDepth, viewLateral } from './projection.ts'

export type ClusterCut = {
  lodError?: number
  level?: number
  sphere?: number[]
  parentError?: number | null
  parentSphere?: number[] | null
  group?: number | null
  source?: number | null
}
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
  if (error === 0) return 0
  if (error == null || error === Infinity || !sphere) return Infinity
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
  )
}
