/** Whether the periodic reset (`surfaceCacheResetEveryNthFrame`) falls on image `frame`: every `every` images, never on the first (the cache has nothing to reset). */
export const periodicResetDue = (frame: number, every: number) =>
  every > 0 && frame > 0 && frame % every === 0
