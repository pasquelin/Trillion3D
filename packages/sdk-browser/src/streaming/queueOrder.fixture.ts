/**
 * Admission order of a queue, written as-is: priority, then arrival order. The engine no longer
 * sorts — it keeps the queue in order by insertion — but the oracle remains the definition of
 * that order, and tests and benches check insertion against it.
 */
export function sortStreamJobs(queue: { priority: number; order: number }[]) {
  queue.sort((a, b) => a.priority - b.priority || a.order - b.order);
}
