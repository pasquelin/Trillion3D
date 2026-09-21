// Pure A12 oracles, no side effects: `streaming.bench.ts` measures them; unit tests import
// them as reference.
const LIMITE = 6,
  BUDGET_TRANSFERT = 2 * 1024 * 1024;

/** A queued job, as `streamingQueueOrderFixture.ts` and the bench build it. */
interface AdmissionJob {
  url: string;
  priority: number;
  order: number;
  consumers: number;
}

/** `streamingQueue.ts:22-59` before batch A: a full sort on every `while` lap, then findIndex. */
export function referenceAdmission(
  queue: AdmissionJob[],
  octetsDe: (url: string) => number | undefined,
) {
  const admis: string[] = [];
  let active = 0,
    activeBytes = 0;
  while (active < LIMITE && queue.length) {
    queue.sort((a, b) => a.priority - b.priority || a.order - b.order);
    const at = queue.findIndex(
      (item) => active === 0 || activeBytes + (octetsDe(item.url) ?? 0) <= BUDGET_TRANSFERT,
    );
    if (at < 0) break;
    const job = queue.splice(at, 1)[0];
    if (job.consumers === 0) continue;
    active++;
    activeBytes += octetsDe(job.url) ?? 0;
    admis.push(job.url);
  }
  return admis;
}

/** A delivery target as the arrival queue read it before batch A: `syncResident` was still
 *  called from the drain, later moved to the caller. */
interface ReferenceTarget {
  acceptPage?(url: string, array: Uint32Array): void;
  syncResident?(): void;
}
interface ReferenceArrival {
  target: ReferenceTarget;
  url: string;
  array: Uint32Array;
}

/** `arrivalQueue.ts:15-65` before batch A: `touched.includes` on every delivered page. */
export function referenceArrivalQueue(byteBudget: number, countBudget: number) {
  const items: ReferenceArrival[] = [],
    waiting = new Map<ReferenceTarget, Set<string>>(),
    touched: ReferenceTarget[] = [];
  let head = 0;
  return {
    queue(target: ReferenceTarget, url: string, array: Uint32Array) {
      if (!target.acceptPage) return false;
      let urls = waiting.get(target);
      if (!urls) waiting.set(target, (urls = new Set()));
      if (urls.has(url)) return false;
      urls.add(url);
      items.push({ target, url, array });
      return true;
    },
    drain() {
      if (head >= items.length) return 0;
      let bytes = 0,
        count = 0;
      touched.length = 0;
      while (head < items.length && bytes < byteBudget && count < countBudget) {
        const item = items[head++];
        waiting.get(item.target)?.delete(item.url);
        item.target.acceptPage?.(item.url, item.array);
        bytes += item.array.byteLength;
        count++;
        if (!touched.includes(item.target)) touched.push(item.target);
      }
      if (head >= items.length) {
        items.length = 0;
        head = 0;
      }
      for (let i = 0; i < touched.length; i++) touched[i].syncResident?.();
      return count;
    },
  };
}
