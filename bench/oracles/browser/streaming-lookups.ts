// Oracles of points G5 and G6, copied as-is before batch G.
import type { Job } from '../../../packages/sdk-browser/src/streaming/types.ts';

/**
 * `packages/sdk-browser/src/streaming/queue.ts`: a request still in the queue, whose last consumer withdraws, was
 * found by a sweep of the whole queue, then removed by shifting the array.
 */
export function referenceRetireDeLaFile(queue: Job[], job: Job) {
  const at = queue.indexOf(job);
  if (at >= 0) queue.splice(at, 1);
}

/**
 * `packages/sdk-browser/src/world/render/draw.ts`: missing addresses were stacked in an array whose membership
 * was tested by `includes`, hence a full sweep for each added address.
 */
export function referenceEmpileEnAttente(attente: string[], urls: readonly string[]) {
  for (const url of urls) if (!attente.includes(url)) attente.push(url);
}
