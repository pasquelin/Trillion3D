import type { StreamContext } from './streamingTypes.ts';
import { compacteFile, findAdmissible, insereTravail } from './streamingQueueOrder.ts';

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
    if (state.dropped) {
      compacteFile(queue);
      state.dropped = 0;
    }
    // La file est tenue en ordre par ses insertions : elle n'est plus triée du tout. Ni le
    // compactage, ni le retrait d'un travail admis ne dérangent cet ordre.
    while (state.active < limit && queue.length) {
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
      insereTravail(queue, job);
    } else {
      const raised = priority < job.priority;
      job.priority = raised ? priority : job.priority;
      // Une demande qui gagne en urgence remonte : elle est reposée à sa nouvelle place, la seule
      // écriture de priorité qui puisse déranger l'ordre. Un travail déjà parti n'est plus en file.
      if (raised && job.state === 'queued') {
        const at = queue.indexOf(job);
        if (at >= 0) {
          queue.splice(at, 1);
          insereTravail(queue, job);
        }
      }
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
          // Marqué, pas retiré : `pump` compacte la file en un passage, et `stats()` retranche les
          // marqués de sa longueur, si bien que le nombre en attente publié ne bouge pas.
          shared.state = 'dropped';
          state.dropped++;
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
