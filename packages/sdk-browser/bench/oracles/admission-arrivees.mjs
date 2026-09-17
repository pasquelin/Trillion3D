// Oracles purs de A12, sans effet de bord : `streaming.bench.mjs` les mesure, les tests unitaires
// les importent comme référence.
const LIMITE = 6,
  BUDGET_TRANSFERT = 2 * 1024 * 1024;

/** `streamingQueue.ts:22-59` avant le lot A : tri complet à chaque tour du `while`, puis findIndex. */
export function referenceAdmission(queue, octetsDe) {
  const admis = [];
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

/** `arrivalQueue.ts:15-65` avant le lot A : `touched.includes` à chaque page livrée. */
export function referenceArrivalQueue(byteBudget, countBudget) {
  const items = [],
    waiting = new Map(),
    touched = [];
  let head = 0;
  return {
    queue(target, url, array) {
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
