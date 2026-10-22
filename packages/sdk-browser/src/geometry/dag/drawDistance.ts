/**
 * THE DRAW DISTANCE ON THE CPU: the arithmetic of `outsideDrawDistances`
 * (`shader/drawDistanceWgsl.ts`), in the same order, for what the host decides of a placement
 * beside the GPU — the placements the rays' scene holds (`proxy/proxyInstances.ts`).
 */

/** Whether an object whose bounds' centre lies `squared` (squared) from the main view's eye is out
 *  of its distances, `near` to `far` times `scale`: nearer or farther. None — never out — for a
 *  `far` of 0 or less. */
export function outsideDrawDistances(squared: number, near: number, far: number, scale: number) {
  if (far <= 0) return false
  const lo = near * scale,
    hi = far * scale
  return squared < lo * lo || squared > hi * hi
}
