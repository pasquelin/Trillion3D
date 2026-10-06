import type { Job } from './types.ts';

/** A queued read of one page, with the promise its consumers share. */
export function createJob(url: string, priority: number, order: number): Job {
  let resolve!: (value: Uint8Array) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<Uint8Array>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return {
    url,
    priority,
    order,
    controller: new AbortController(),
    state: 'queued',
    consumers: new Set(),
    promise,
    resolve,
    reject,
  };
}

/** One consumer of a shared job: settles once, with the job's outcome or its own abort. When it
 *  leaves and was the last, `abandon` runs. */
export function joinJob(
  job: Job,
  url: string,
  combined: AbortSignal,
  fallbackReason: () => unknown,
  abandon: () => void,
): Promise<Uint8Array> {
  const token = Symbol(url);
  job.consumers.add(token);
  return new Promise<Uint8Array>((resolve, reject) => {
    let settled = false;
    const finish = (ok: boolean, value: Uint8Array | unknown) => {
      if (settled) return;
      settled = true;
      combined.removeEventListener('abort', onAbort);
      job.consumers.delete(token);
      if (job.consumers.size === 0) abandon();
      if (ok) resolve(value as Uint8Array);
      else reject(value);
    };
    const onAbort = () => finish(false, combined.reason ?? fallbackReason());
    combined.addEventListener('abort', onAbort, { once: true });
    job.promise.then(
      (value) => finish(true, value),
      (error) => finish(false, error),
    );
    if (combined.aborted) onAbort();
  });
}
