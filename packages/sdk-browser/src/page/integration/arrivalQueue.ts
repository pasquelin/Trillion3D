/**
 * Index-page arrival queue: what arrives from cache or network no longer enters the frame
 * that discovered it. Each arrival is queued, PLANNED off the main thread, then a single
 * bounded drain at the head of the next frame makes it resident before selection. A frame
 * therefore never carries more than this integration budget, and a whole-batch burst no
 * longer lands in the middle of a `renderer.render`. Arrival order is preserved: a drain
 * resumes exactly where the previous one stopped, and the order in which the frame named
 * its missing pages is already its priority order — the most costly to miss first.
 *
 * The plan is what the main thread no longer computes: for each record in the packet, its
 * first word and its word count, and the page ranks the arrival touches, sorted. It leaves
 * at enqueue time and returns before the drain; the target only has to set views and write.
 * No page bytes travel for that — only the catalogue integer sheet. When there is nothing
 * to plan, or no worker to plan it, the plan is already there at enqueue: the arrival is
 * then deliverable in the same turn, and no wait is added to what the batch replaced.
 *
 * The ceiling that counts is TIME. An arrival carries a streaming packet whose cluster
 * count is not known in advance: neither index bytes nor page count therefore bound the
 * duration it costs. The drain rereads the clock after each delivery and yields as soon
 * as the ceiling is reached; the rest waits for the next frame. At least one delivery
 * always goes through, otherwise a page longer to integrate than the ceiling would never
 * enter.
 */
import { planArrival, planArrivalHere, type ArrivalPlan } from './host.ts';

/** What the queue requires of a target: a way to receive a page before the next render, and
 *  the catalogue sheet for the request — the integers the plan is deduced from, and nothing else. */
export type ArrivalTarget = {
  acceptPage?(url: string, array: Uint32Array, plan?: ArrivalPlan): void;
  pageSpecs?(url: string): Int32Array | undefined;
};

type Arrival = {
  target: ArrivalTarget;
  url: string;
  array: Uint32Array;
  plan: ArrivalPlan | undefined;
  ready: boolean;
  done: boolean;
  waits: number;
};

/**
 * Drains an arrival may spend at the head of the queue without its plan having returned. Beyond
 * that, the frame no longer waits: the plan is rebuilt inline, on the main thread, rather than
 * let a slow transport punch a hole in the frame. Two frames, not one: a message round-trip
 * easily fits in the time that separates the arrival from the next drain.
 */
const MAX_PLAN_WAITS = 2;

export function createArrivalQueue(byteBudget: number, countBudget: number, msBudget = 2) {
  const items: Arrival[] = [];
  // The same page may be seen by the cache then by the end of its download: while it waits,
  // it is queued only once per target. The wait is forgotten as soon as it is delivered.
  const waiting = new Map<ArrivalTarget, Set<string>>();
  let head = 0;
  /** Delivers an arrival with its plan, and removes its address from the waiting pages. */
  const deliver = (item: Arrival) => {
    item.done = true;
    waiting.get(item.target)?.delete(item.url);
    item.target.acceptPage?.(item.url, item.array, item.plan);
  };
  return {
    /** Arrivals still waiting to drain. */
    get pending() {
      return items.length - head;
    },
    /** Queues a page for a target; without `acceptPage` it has nothing to do with it. */
    queue(target: ArrivalTarget, url: string, array: Uint32Array) {
      if (!target.acceptPage) return false;
      let urls = waiting.get(target);
      if (!urls) {
        urls = new Set();
        waiting.set(target, urls);
      }
      if (urls.has(url)) return false;
      urls.add(url);
      const item: Arrival = {
        target,
        url,
        array,
        plan: undefined,
        ready: false,
        done: false,
        waits: 0,
      };
      items.push(item);
      const planned = planArrival(url, array.length, target.pageSpecs?.(url));
      // A plan already there — nothing to plan, or no off-thread queue — is not a wait: it
      // makes the arrival deliverable as soon as it is queued. Only a message that actually left waits.
      if (planned instanceof Promise)
        void planned.then((plan) => {
          // An arrival already delivered — the frame stopped waiting for it — ignores its late plan.
          if (item.done) return;
          item.plan = plan;
          item.ready = true;
        });
      else {
        item.plan = planned;
        item.ready = true;
      }
      return true;
    },
    /**
     * Delivers arrivals up to the budget — at most `countBudget` pages, `byteBudget` index bytes
     * and `msBudget` milliseconds spent integrating them. The following render synchronizes residency;
     * calling `syncResident` here could draw a second frame. Returns the pages delivered.
     */
    drain() {
      if (head >= items.length) return 0;
      const started = performance.now();
      let bytes = 0,
        count = 0;
      while (head < items.length && bytes < byteBudget && count < countBudget) {
        const item = items[head];
        if (!item.ready) {
          // Order is priority: an arrival whose plan has not returned holds back those that
          // follow, for two drains, then is planned inline and goes through.
          if (item.waits++ < MAX_PLAN_WAITS) break;
          // Same function, same result, on the main thread: the contract fallback is synchronous.
          item.plan = planArrivalHere(
            item.url,
            item.array.length,
            item.target.pageSpecs?.(item.url),
          );
        }
        head++;
        deliver(item);
        bytes += item.array.byteLength;
        count++;
        if (performance.now() - started >= msBudget) break;
      }
      if (head >= items.length) {
        items.length = 0;
        head = 0;
      }
      return count;
    },
  };
}
