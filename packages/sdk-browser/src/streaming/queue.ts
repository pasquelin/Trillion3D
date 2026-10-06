import type { Job, StreamContext } from './types.ts';
import { joinJob } from './queueJob.ts';
import { compacteFile, findAdmissible } from './queueOrder.ts';
import { startTransfer } from './queueTransfer.ts';
import { answerFromCache, jobFor } from './queueRequest.ts';

export function createStreamingQueue(
  context: StreamContext,
  loadOne: (url: string, signal: AbortSignal) => Promise<Uint8Array>,
  touch: (url: string, bytes: Uint8Array) => void,
  evict: () => void,
  /** Marks a page's hold in the cache's eviction order when its transfer starts or ends. */
  sync: (url: string) => void,
) {
  const {
    state,
    abort,
    limit,
    queue,
    catalog,
    maxTransferBytes,
    emit,
    jobs,
    failures,
    store,
    abortError,
  } = context;
  /** Pages `forget` asked to drop while a job held them: they leave when it settles, unless
   *  `keep` takes them back first (#572). */
  const forgotten = new Set<string>();
  /** A page leaves the catalogue with its bytes and its failure. */
  const drop = (url: string) => {
    failures.delete(url);
    if (catalog.delete(url)) store.drop(url);
  };
  const forget = (url: string) => {
    if (jobs.has(url)) forgotten.add(url);
    else drop(url);
  };
  /** The single exit of a job: it releases its url, and a page forgotten meanwhile leaves. After
   *  `dispose` a kept store is the next session's: a late settle no longer drops from it. */
  const end = (url: string, job: Job) => {
    if (jobs.get(url) === job) jobs.delete(url);
    sync(url);
    if (!jobs.has(url) && forgotten.delete(url) && !state.disposed) drop(url);
  };
  const octetsDe = (url: string) => catalog.get(url)?.bytes;
  const pump = () => {
    if (state.disposed || abort.signal.aborted) return;
    if (state.dropped) {
      compacteFile(queue);
      state.dropped = 0;
    }
    // The queue is kept in order by its insertions: it is no longer sorted at all. Neither
    // compaction nor removing an admitted job disturbs that order.
    while (state.active < limit && queue.length) {
      const at = findAdmissible(queue, state.active, state.activeBytes, octetsDe, maxTransferBytes);
      if (at < 0) break;
      const job = queue.splice(at, 1)[0];
      if (job.consumers.size === 0 || job.controller.signal.aborted) continue;
      startTransfer(context, loadOne, job, { end, evict, pump });
    }
  };
  const subscribe = (
    url: string,
    requestSignal?: AbortSignal,
    priority = 1,
  ): Promise<Uint8Array> => {
    emit?.('page-request', 'Page request received', () => ({ version: 1, url, priority }));
    if (state.disposed || abort.signal.aborted)
      return Promise.reject(abort.signal.reason ?? abortError());
    if (requestSignal?.aborted) return Promise.reject(requestSignal.reason ?? abortError());
    if (!catalog.has(url)) return Promise.reject(new Error('Unknown page ' + url));
    const failure = failures.get(url);
    if (failure) return Promise.reject(failure);
    const cached = answerFromCache(context, touch, url);
    if (cached) return Promise.resolve(cached);
    const job = jobFor(context, sync, url, priority);
    const shared = job;
    const combined = requestSignal ? AbortSignal.any([abort.signal, requestSignal]) : abort.signal;
    const result = joinJob(shared, url, combined, abortError, () => {
      // A transfer that has already started is paid for: letting it land in the cache costs nothing
      // more and keeps a superseded camera from throwing away bytes it is about to ask for again.
      // Only a request still waiting in the queue is dropped.
      if (jobs.get(url) === shared && shared.state === 'queued') {
        end(url, shared);
        shared.controller.abort(abortError());
        emit?.('page-stream-abort', 'Pending request cancelled', () => ({ version: 1, url }));
        // Marked, not removed: `pump` compacts the queue in one pass, and `stats()` subtracts
        // the marked from its length, so the published pending count does not move.
        shared.state = 'dropped';
        state.dropped++;
      }
    });
    pump();
    return result;
  };
  return { pump, subscribe, forget, keep: (url: string) => forgotten.delete(url) };
}
