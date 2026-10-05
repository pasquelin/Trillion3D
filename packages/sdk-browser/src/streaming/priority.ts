/** Request priorities: the streamer serves the smallest number first. The root cover needs none of
 *  them — it is asked for on its own, before anything else is offered. */
export const PRIORITY_VISIBLE = 1,
  PRIORITY_PREFETCH = 3;

/** Pixels per unit of extent in view space at unit depth, from a projection and a viewport. */
export function pixelScaleOf<T extends number[]>(
  projection: ArrayLike<number>,
  viewport: readonly number[] | undefined,
  into: T,
) {
  const width = viewport?.[0] ?? 1,
    height = viewport?.[1] ?? 1;
  into[0] = (width * Math.abs(projection[0])) / 2;
  into[1] = (height * Math.abs(projection[5])) / 2;
  return into;
}

const footprintViewport = [1, 1],
  footprintScale = [0, 0];
/**
 * World size of one pixel per unit of view depth under a perspective projection, or the size of
 * one pixel under an orthographic one: the reciprocal of `pixelScaleOf`'s vertical scale. The
 * shadow read chooses its level from it; the scheduler, from its value at the near plane.
 */
export function pixelFootprintOf(projection: ArrayLike<number>, height: number) {
  footprintViewport[1] = Math.max(1, height);
  return 1 / pixelScaleOf(projection, footprintViewport, footprintScale)[1];
}
