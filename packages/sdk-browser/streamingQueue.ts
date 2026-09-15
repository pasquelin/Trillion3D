import type { StreamContext } from './streamingTypes.ts';

/** L'ordre d'admission d'une file : priorité, puis ordre d'arrivée. */
export function sortStreamJobs(queue: { priority: number; order: number }[]) {
  queue.sort((a, b) => a.priority - b.priority || a.order - b.order);
}

/**
 * Le premier travail que le budget de transfert laisse partir, ou -1. Le premier transfert d'une
 * file part toujours : sans lui rien n'avancerait quand une seule page dépasse le budget.
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

export function createStreamingQueue(
  context: StreamContext,
  loadOne: (url: string, signal: AbortSignal) => Promise<Uint8Array>,
  touch: (url: string, bytes: Uint8Array) => void,
  evict: () => void,
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
    cache,
    abortError,
  } = context;
  const octetsDe = (url: string) => catalog.get(url)?.bytes;
  const pump = () => {
    if (state.disposed || abort.signal.aborted) return;
    // La file n'est triée qu'une fois par passage : rien n'y entre pendant la boucle, et retirer un
    // travail ne dérange pas l'ordre. Le tri repartait de zéro à chaque tour du `while`.
    let triee = false;
    while (state.active < limit && queue.length) {
      if (!triee) {
        sortStreamJobs(queue);
        triee = true;
      }
      const at = findAdmissible(queue, state.active, state.activeBytes, octetsDe, maxTransferBytes);
      if (at < 0) break;
      const job = queue.splice(at, 1)[0];
      if (job.consumers.size === 0 || job.controller.signal.aborted) continue;
      job.state = 'active';
      state.active++;
      state.activeBytes += catalog.get(job.url)!.bytes;
      emit('page-transfer-start', 'Transfert de page admis', () => ({
        version: 1,
        url: job.url,
        active: state.active,
        transferInFlightBytes: state.activeBytes,
        maxTransferBytes,
      }));
      void loadOne(job.url, job.controller.signal)
        .then(job.resolve, job.reject)
        .finally(() => {
          state.active--;
          state.activeBytes -= catalog.get(job.url)!.bytes;
          if (jobs.get(job.url) === job) jobs.delete(job.url);
          emit('page-transfer-end', 'Transfert de page terminé', () => ({
            version: 1,
            url: job.url,
            active: state.active,
            transferInFlightBytes: state.activeBytes,
          }));
          evict();
          pump();
        });
    }
  };
  const subscribe = (
    url: string,
    requestSignal?: AbortSignal,
    priority = 1,
  ): Promise<Uint8Array> => {
    emit('page-request', 'Demande de page reçue', () => ({ version: 1, url, priority }));
    if (state.disposed || abort.signal.aborted)
      return Promise.reject(abort.signal.reason ?? abortError());
    if (requestSignal?.aborted) return Promise.reject(requestSignal.reason ?? abortError());
    if (!catalog.has(url)) return Promise.reject(new Error('Unknown page ' + url));
    const failure = failures.get(url);
    if (failure) return Promise.reject(failure);
    const cached = cache.get(url);
    if (cached) {
      state.hits++;
      touch(url, cached);
      emit('page-cache-hit', 'Page déjà résidente', () => ({
        version: 1,
        url,
        resident: cache.size,
      }));
      return Promise.resolve(cached);
    }
    state.misses++;
    emit('page-cache-miss', 'Page absente du cache', () => ({
      version: 1,
      url,
      resident: cache.size,
    }));
    let job = jobs.get(url);
    if (!job) {
      let resolve!: (value: Uint8Array) => void, reject!: (reason: unknown) => void;
      const promise = new Promise<Uint8Array>((yes, no) => {
        resolve = yes;
        reject = no;
      });
      job = {
        url,
        priority,
        order: state.order++,
        controller: new AbortController(),
        state: 'queued',
        consumers: new Set(),
        promise,
        resolve,
        reject,
      };
      jobs.set(url, job);
      queue.push(job);
    } else {
      job.priority = Math.min(job.priority, priority);
      emit('page-request-coalesced', 'Demande jointe à une lecture en cours', () => ({
        version: 1,
        url,
        loading: jobs.size,
      }));
    }
    const shared = job,
      token = Symbol(url);
    shared.consumers.add(token);
    const combined = requestSignal ? AbortSignal.any([abort.signal, requestSignal]) : abort.signal;
    const result = new Promise<Uint8Array>((resolve, reject) => {
      let settled = false;
      const finish = (ok: boolean, value: Uint8Array | unknown) => {
        if (settled) return;
        settled = true;
        combined.removeEventListener('abort', onAbort);
        shared.consumers.delete(token);
        // A transfer that has already started is paid for: letting it land in the cache costs nothing
        // more and keeps a superseded camera from throwing away bytes it is about to ask for again.
        // Only a request still waiting in the queue is dropped.
        if (shared.consumers.size === 0 && jobs.get(url) === shared && shared.state === 'queued') {
          jobs.delete(url);
          shared.controller.abort(abortError());
          emit('page-stream-abort', 'Demande en attente annulée', () => ({ version: 1, url }));
          const at = queue.indexOf(shared);
          if (at >= 0) queue.splice(at, 1);
        }
        if (ok) resolve(value as Uint8Array);
        else reject(value);
      };
      const onAbort = () => finish(false, combined.reason ?? abortError());
      combined.addEventListener('abort', onAbort, { once: true });
      shared.promise.then(
        (value) => finish(true, value),
        (error) => finish(false, error),
      );
      if (combined.aborted) onAbort();
    });
    pump();
    return result;
  };
  return { pump, subscribe };
}
