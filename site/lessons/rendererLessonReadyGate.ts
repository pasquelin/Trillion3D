import type { Settle } from './rendererLessonSessionTypes.ts';

/**
 * The frame loop's settle gate: `nextReady()` opens a new promise that `settleResolve`/
 * `settleReject` resolves or rejects once a frame has drawn (or startup fails), so a caller can
 * await "the next result" without its own bookkeeping.
 */
export function createReadyGate() {
  let ready: Promise<unknown> = Promise.resolve();
  let resolve: Settle | undefined;
  let reject: Settle | undefined;
  const nextReady = () => {
    ready = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    ready.catch(() => {});
    return ready;
  };
  const settleResolve = (value?: unknown) => {
    resolve?.(value);
    resolve = reject = undefined;
  };
  const settleReject = (error?: unknown) => {
    reject?.(error);
    resolve = reject = undefined;
  };
  return {
    nextReady,
    settleResolve,
    settleReject,
    get current() {
      return ready;
    },
  };
}
