import { clusterErrorAtDepth } from '../../../../sdk-core/src/lod/screenErrorBound.ts'

/**
 * Distance to the view axis, `|(view(p).x, view(p).y)|`, of a point given component by component:
 * the flat cut takes it from a sphere stored in an array, the cluster-DAG oracle from three
 * already-separated numbers. One write of the multiplies, the sums and the square root.
 */
export function viewLateralOf(x: number, y: number, z: number, e: ArrayLike<number>) {
  const vx = e[0] * x + e[4] * y + e[8] * z + e[12]
  const vy = e[1] * x + e[5] * y + e[9] * z + e[13]
  return Math.sqrt(vx * vx + vy * vy)
}

/** View depth, `−view(p).z` (the camera looks toward −z), of the same point. No square root. */
export function viewDepthOf(x: number, y: number, z: number, e: ArrayLike<number>) {
  return -(e[2] * x + e[6] * y + e[10] * z + e[14])
}

/** `viewLateralOf` of the centre of a sphere stored at `offset`. */
export function viewLateral(sphere: ArrayLike<number>, offset: number, e: ArrayLike<number>) {
  return viewLateralOf(sphere[offset], sphere[offset + 1], sphere[offset + 2], e)
}

/** `viewDepthOf` of the centre of a sphere stored at `offset`. */
export function viewDepth(sphere: ArrayLike<number>, offset: number, e: ArrayLike<number>) {
  return viewDepthOf(sphere[offset], sphere[offset + 1], sphere[offset + 2], e)
}

/** `projectedClusterError` whose axis distance and centre depth are already known. */
export function projectedErrorAt(
  error: number | null | undefined,
  lateral: number,
  depth: number,
  radius: number,
  stretch: number,
  focal: number,
  near: number,
  perspective = 1,
) {
  if (error === 0) return 0
  if (error == null || error === Infinity) return Infinity
  return clusterErrorAtDepth(error, stretch, lateral, depth, radius, focal, near, perspective)
}
