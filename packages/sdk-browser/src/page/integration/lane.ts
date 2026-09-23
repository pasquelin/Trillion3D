import { PAGE_INTEGRATION_PROTOCOL } from '../../../../sdk-core/src/index.ts';
import type {
  PageIntegrationAnswer,
  PageIntegrationRequest,
} from '../../../../sdk-core/src/index.ts';

const workerError = (id: number, url: string): PageIntegrationAnswer => ({
  protocol: PAGE_INTEGRATION_PROTOCOL,
  id,
  ok: false,
  url,
  code: 'PAGE_INTEGRATION_WORKER',
  message: 'PAGE_INTEGRATION_WORKER',
});

/**
 * One worker, one queue, send order kept intact. Browser adapter: this is the only integration
 * file that constructs a `Worker`.
 *
 * One thread, not a pool: the integration order IS the frame's priority, and two threads would
 * return their plans in the order of their load. The work planned here is integer arithmetic
 * on a few hundred records; it is the main thread that must be freed, not one more core that
 * must be occupied.
 *
 * `start` is the startup gate: a probe request goes first, and a start that fails — no
 * `Worker`, module not found — leaves the caller to its in-line fallback. After start, the
 * worker's disappearance breaks the queue: in-flight work answers `PAGE_INTEGRATION_WORKER`,
 * and everything after that goes back in-line.
 */
export function createPageIntegrationLane() {
  const pending = new Map<number, (answer: PageIntegrationAnswer) => void>();
  let worker: Worker | undefined,
    alive = true,
    nextId = 1;
  // The worker module carries the extension of the module that launches it: `.ts` in a source
  // tree served as-is, `.js` in a built `dist/`.
  const source = new URL(
    import.meta.url.endsWith('.ts') ? './pageIntegrationWorker.ts' : './pageIntegrationWorker.js',
    import.meta.url,
  );
  const breakLane = () => {
    if (!alive) return;
    alive = false;
    const lost = [...pending.entries()];
    pending.clear();
    worker?.terminate();
    worker = undefined;
    for (const [id, settle] of lost) settle(workerError(id, ''));
  };
  const spawn = () => {
    const spawned = new Worker(source, { type: 'module' });
    spawned.onmessage = (event: MessageEvent) => {
      const answer = event.data as PageIntegrationAnswer;
      const settle = pending.get(answer.id);
      pending.delete(answer.id);
      settle?.(answer);
    };
    spawned.onerror = breakLane;
    spawned.onmessageerror = breakLane;
    return spawned;
  };

  const submit = (url: string, words: number, specs: ArrayBuffer | null) => {
    const request: PageIntegrationRequest = {
      protocol: PAGE_INTEGRATION_PROTOCOL,
      id: nextId++,
      url,
      words,
      specs,
    };
    if (!alive || !worker) return Promise.resolve(workerError(request.id, url));
    return new Promise<PageIntegrationAnswer>((resolve) => {
      pending.set(request.id, resolve);
      try {
        worker!.postMessage(request, specs ? [specs] : []);
      } catch {
        breakLane();
      }
    });
  };

  let ready: Promise<boolean> | undefined;
  return {
    get alive() {
      return alive;
    },
    /** True once the worker has answered the startup probe; false and the queue closed otherwise. */
    start() {
      ready ??= (async () => {
        if (typeof Worker === 'undefined') {
          breakLane();
          return false;
        }
        try {
          worker = spawn();
          const answer = await submit('', 0, new Int32Array(0).buffer as ArrayBuffer);
          if (!answer.ok) breakLane();
          return answer.ok;
        } catch {
          breakLane();
          return false;
        }
      })();
      return ready;
    },
    submit,
    retire: breakLane,
  };
}
