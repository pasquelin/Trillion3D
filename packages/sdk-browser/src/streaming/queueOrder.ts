import type { Job } from './types.ts';

/**
 * Insertion rank of a priority in a queue already in order: the first job it precedes.
 * A binary search, hence a logarithm of comparisons where re-sorting the whole queue
 * cost `n log n` — and a moving camera stacks requests every frame.
 */
function rangDInsertion(queue: readonly { priority: number }[], priority: number) {
  let low = 0,
    high = queue.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (queue[mid].priority <= priority) low = mid + 1;
    else high = mid;
  }
  return low;
}

/**
 * Place a job at its slot in a queue kept in order. Its arrival number is the largest
 * ever set: it therefore goes to the tail of its priority group, and order is kept without a sort.
 */
export function insereTravail(queue: Job[], job: Job) {
  const at = rangDInsertion(queue, job.priority);
  if (at === queue.length) queue.push(job);
  else queue.splice(at, 0, job);
}

/**
 * Remove from the queue, in one pass and without disturbing order, the jobs a cancellation
 * marked. A burst of cancellations — what a fast camera produces every frame — used to
 * pay a sweep of the queue per abandoned request to find its place.
 */
export function compacteFile(queue: Job[]) {
  let garde = 0;
  for (let i = 0; i < queue.length; i++)
    if (queue[i].state !== 'dropped') queue[garde++] = queue[i];
  queue.length = garde;
}

/**
 * The first job the transfer budget lets go, or -1. The first transfer of a queue always
 * leaves: without it nothing would move when a single page exceeds the budget.
 */
export function findAdmissible(
  queue: readonly { url: string }[],
  active: number,
  activeBytes: number,
  bytesOf: (url: string) => number | undefined,
  maxTransferBytes: number,
) {
  for (let i = 0; i < queue.length; i++)
    if (active === 0 || activeBytes + (bytesOf(queue[i].url) ?? 0) <= maxTransferBytes) return i;
  return -1;
}
