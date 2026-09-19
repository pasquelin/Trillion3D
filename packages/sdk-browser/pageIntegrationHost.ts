import { PAGE_INTEGRATION_PROTOCOL } from '../sdk-core/index.ts';
import { createPageIntegrationLane } from './pageIntegrationLane.ts';
import { createPageIntegrationRunner } from './pageIntegrationTask.ts';
import type { PageIntegrationAnswer } from '../sdk-core/index.ts';

/** What a planned arrival returns to the main thread: integers, already in the record's order. */
export type ArrivalPlan = {
  url: string;
  slices: Int32Array;
  count: number;
  pages: Int32Array;
  pageCount: number;
};

const counters = { plans: 0, offThread: 0, planMs: 0 };
/** Fallback: the same task, the same function, run on the main thread. */
const inline = createPageIntegrationRunner();
const inlineKnown = new Set<string>();
let lane: ReturnType<typeof createPageIntegrationLane> | undefined;
let laneKnown = new Set<string>();
/** `undefined` until the startup check has answered, then its verdict. */
let started: boolean | undefined;

/**
 * The integration lane if its startup probe has already succeeded, `undefined` otherwise.
 * The probe is launched but **never awaited**: until it has answered, and always if it
 * does not, the plan is made on the main thread. An arrival therefore never depends on
 * a worker starting. A lane broken after its start does not come back.
 */
function openLane() {
  if (started === false) return undefined;
  if (!lane) {
    lane = createPageIntegrationLane();
    void lane.start().then((ok) => {
      started = ok;
      if (!ok) lane = undefined;
    });
  }
  if (started && !lane.alive) {
    started = false;
    return undefined;
  }
  return started ? lane : undefined;
}

const read = (answer: PageIntegrationAnswer, offThread: boolean): ArrivalPlan | undefined => {
  if (!answer.ok) return undefined;
  counters.plans++;
  counters.planMs += answer.taskMs;
  if (offThread) counters.offThread++;
  return {
    url: answer.url,
    slices: new Int32Array(answer.slices),
    count: answer.count,
    pages: new Int32Array(answer.pages),
    pageCount: answer.pageCount,
  };
};

/**
 * The plan made inline, with the record the caller holds: it fails only if that is
 * missing. That is the contract fallback, and also what a frame that has stopped
 * waiting for its plan calls.
 */
export function planArrivalHere(url: string, words: number, specs: Int32Array | undefined) {
  const send = !inlineKnown.has(url);
  if (send && specs) inlineKnown.add(url);
  return read(
    inline.run({
      protocol: PAGE_INTEGRATION_PROTOCOL,
      id: 0,
      url,
      words,
      specs: send && specs ? (specs.slice().buffer as ArrayBuffer) : null,
    }),
    false,
  );
}

/**
 * Integration plan of an arrived packet, computed off the main thread when the
 * platform allows, and by the same function on the main thread otherwise. One
 * logical path, two transports: the returned plan is the same to the bit, because
 * it is the same integer arithmetic in the same order.
 *
 * The return says which of the two served: a PLAN when it was already there — no
 * lane open, or nothing to plan — and a PROMISE only when a message actually left.
 * The caller therefore never waits a round-trip that does not happen: an inline
 * planned arrival is deliverable in the turn it is stacked, and that is what the
 * drain applies.
 *
 * No page byte travels: a request record — offsets, triangles, page ranks — holds
 * only catalogue integers, and it only leaves on the first arrival of that address.
 * The cache buffer therefore stays intact with its owner, neither copied nor detached.
 */
export function planArrival(
  url: string,
  words: number,
  specs: Int32Array | undefined,
): ArrivalPlan | undefined | Promise<ArrivalPlan | undefined> {
  const open = openLane();
  // Without a record, and without a record already known to the lane, there is nothing to
  // plan: the inline fallback says so at once rather than sending a message for a refusal.
  if (!open || (!specs && !laneKnown.has(url))) return planArrivalHere(url, words, specs);
  const send = !laneKnown.has(url);
  if (send && specs) laneKnown.add(url);
  const sent = open.submit(
    url,
    words,
    send && specs ? (specs.slice().buffer as ArrayBuffer) : null,
  );
  return sent.then((answer) => {
    // A vanished worker, or a worker without the record, loses nothing: the bytes stayed
    // with their owner, and the main thread can make the same plan.
    if (!answer.ok) {
      if (!open.alive) laneKnown = new Set();
      else laneKnown.delete(url);
      return planArrivalHere(url, words, specs);
    }
    return read(answer, true);
  });
}

/** Off-thread plans and cumulative plan time. `null` when nothing was planned: an
 *  unmeasured metric is not a zero. */
export function pageIntegrationStats() {
  if (!counters.plans) return { offThread: null, planMs: null };
  return { offThread: counters.offThread, planMs: counters.planMs };
}

/** Closes the lane and resets the counters to their unmeasured state. */
export function releasePageIntegration() {
  lane?.retire();
  lane = undefined;
  started = undefined;
  laneKnown = new Set();
  inlineKnown.clear();
  counters.plans = 0;
  counters.offThread = 0;
  counters.planMs = 0;
}
