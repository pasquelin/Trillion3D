import { PAGE_DECODE_PROTOCOL } from '../sdk-core/index.ts';
import {
  ID,
  SHARED_BY_REGION,
  SHARED_READY,
  STATUS,
  awaitSharedPage,
  beginSharedPage,
  freeSharedPage,
  loseSharedPage,
  sharedField,
} from './pageDecodeShared.ts';
import { readSharedPage } from './pageDecodeSharedPage.ts';
import type { PageArena } from './pageDecodeShared.ts';
import type { PageDecodeAnswer, PageDecodeRequest } from '../sdk-core/index.ts';

type Waiting = {
  request: PageDecodeRequest;
  transfer: ArrayBuffer[];
  settle: (answer: PageDecodeAnswer) => void;
};
const workerError = (id: number): PageDecodeAnswer => ({
  protocol: PAGE_DECODE_PROTOCOL,
  id,
  ok: false,
  code: 'PAGE_DECODE_WORKER',
  message: 'PAGE_DECODE_WORKER',
});

/**
 * A bounded pool of module workers, one job at a time per worker, the rest queued. Browser
 * adapter: this is the only file that constructs a `Worker`.
 *
 * `ready` is the startup gate: the first worker receives a probe request, and until its answer
 * has come back, no real buffer is transferred. A start that fails — no `Worker`, module not
 * found, `crypto` missing — therefore leaves the caller with its bytes intact and its
 * synchronous fallback. After start, a worker's disappearance breaks the pool: in-flight work
 * answers `PAGE_DECODE_WORKER`, and everything after that goes back to the fallback.
 *
 * With an arena, each worker receives at birth a slot and the matching region, and decoded
 * pages come back that way rather than by message. The slot carries the worker index: one
 * worker, one region, one writer. Without an arena, nothing changes.
 */
export function createPageDecodePool(size: number, arena?: PageArena) {
  const idle: Worker[] = [],
    all: Worker[] = [],
    queue: Waiting[] = [];
  const pending = new Map<number, Waiting>(),
    owner = new Map<number, Worker>();
  let nextId = 1,
    alive = true,
    retired = false;
  // The worker module carries the extension of the module that launches it: `.ts` in a source
  // tree served as-is, `.js` in a built `dist/`. A fixed string would always hit the wrong file
  // on one of the two sides, and a missing worker would send everything to the fallback without saying so.
  const source = new URL(
    import.meta.url.endsWith('.ts') ? './pageDecodeWorker.ts' : './pageDecodeWorker.js',
    import.meta.url,
  );
  const spawn = () => {
    const worker = new Worker(source, { type: 'module' });
    worker.onmessage = (event: MessageEvent) => receive(worker, event.data as PageDecodeAnswer);
    worker.onerror = () => breakPool();
    worker.onmessageerror = () => breakPool();
    all.push(worker);
    if (arena)
      worker.postMessage(
        {
          protocol: PAGE_DECODE_PROTOCOL,
          id: 0,
          op: 'share',
          buffer: arena.buffer,
          slot: all.length - 1,
          slots: arena.slots,
        },
        [],
      );
    return worker;
  };
  const receive = (worker: Worker, answer: PageDecodeAnswer) => {
    const waiting = pending.get(answer.id);
    pending.delete(answer.id);
    owner.delete(answer.id);
    if (!retired) idle.push(worker);
    waiting?.settle(answer);
    if (!retired) pump();
    else if (pending.size) worker.terminate();
    else breakPool();
  };
  /** The page published in the slot, or nothing when the worker lost it or answered by message.
   *  The slot becomes free again in every case: a death mid-decode does not confiscate it. */
  const collect = async (worker: Worker, shared: PageArena, slot: number, id: number) => {
    const state = await awaitSharedPage(shared, slot);
    const served =
      state === SHARED_READY &&
      sharedField(shared, slot, STATUS) === SHARED_BY_REGION &&
      sharedField(shared, slot, ID) === id;
    const answer = served ? readSharedPage(shared, slot) : undefined;
    freeSharedPage(shared, slot);
    if (answer && alive) receive(worker, answer);
  };
  const breakPool = () => {
    if (!alive) return;
    alive = false;
    if (arena) for (let slot = 0; slot < arena.slots; slot++) loseSharedPage(arena, slot);
    const lost = [...pending.values(), ...queue.splice(0)];
    pending.clear();
    owner.clear();
    idle.length = 0;
    for (const worker of all.splice(0)) worker.terminate();
    for (const waiting of lost) waiting.settle(workerError(waiting.request.id));
  };
  const pump = () => {
    while (alive && queue.length && (idle.length || all.length < size)) {
      const waiting = queue.shift()!;
      const worker = idle.pop() ?? spawn();
      pending.set(waiting.request.id, waiting);
      owner.set(waiting.request.id, worker);
      const slot = arena && waiting.request.op === 'decode' ? all.indexOf(worker) : -1;
      if (arena && slot >= 0) beginSharedPage(arena, slot, waiting.request.id);
      try {
        worker.postMessage(waiting.request, waiting.transfer);
      } catch {
        breakPool();
        return;
      }
      if (arena && slot >= 0) void collect(worker, arena, slot, waiting.request.id);
    }
  };
  const submit = (op: PageDecodeRequest['op'], source: ArrayBuffer, maxDecodedBytes: number) => {
    const request: PageDecodeRequest = {
      protocol: PAGE_DECODE_PROTOCOL,
      id: nextId++,
      op,
      source,
      maxDecodedBytes,
    };
    if (!alive || retired)
      return { id: request.id, answer: Promise.resolve(workerError(request.id)) };
    const answer = new Promise<PageDecodeAnswer>((resolve) => {
      queue.push({ request, transfer: [source], settle: resolve });
      pump();
    });
    return { id: request.id, answer };
  };
  let ready: Promise<boolean> | undefined;
  return {
    get alive() {
      return alive;
    },
    get workers() {
      return size;
    },
    /** True once a worker has answered the startup probe; false and the pool closed otherwise. */
    start() {
      ready ??= (async () => {
        try {
          const answer = await submit('verify', new ArrayBuffer(8), 0).answer;
          if (!answer.ok) breakPool();
          return answer.ok;
        } catch {
          breakPool();
          return false;
        }
      })();
      return ready;
    },
    submit,
    /** Asks to drop a request still in the queue. No effect on a decode already begun. */
    cancel(id: number) {
      const worker = owner.get(id);
      if (!alive || !worker) return;
      try {
        worker.postMessage({ protocol: PAGE_DECODE_PROTOCOL, id, op: 'cancel' }, []);
      } catch {
        breakPool();
      }
    },
    /** Closes the pool without cutting in-flight work: idle workers stop at once. */
    retire() {
      retired = true;
      for (const worker of idle.splice(0)) worker.terminate();
      if (!pending.size) breakPool();
    },
  };
}
export type PageDecodePool = ReturnType<typeof createPageDecodePool>;
