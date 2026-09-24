/**
 * World size of one pixel per unit of view depth under a perspective projection, or the size of
 * one pixel under an orthographic one: `2 / (P[1][1] · height)`. The shadow read chooses its
 * level from it; the scheduler, from its value at the near plane (`pixelNear`).
 */
export const pixelScaleOf = (projection: ArrayLike<number>, height: number) =>
  2 / (Math.abs(projection[5]) * Math.max(1, height));

/** A pixel's footprint at the near plane: the finest any pixel of the view has. */
export const pixelNearOf = (projection: ArrayLike<number>, height: number, near: number) =>
  pixelScaleOf(projection, height) * (projection[15] === 0 ? near : 1);
