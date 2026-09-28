/**
 * Threads of the physics module, without emscripten's glue. The threaded module
 * (`joltPhysicsThreads.wasm`) runs Jolt's own thread pool; each of its threads starts in C through
 * `pthread_create`, which calls the `__pthread_create_js` import below: the loader answers with a
 * worker that instantiates the same module on the same shared memory, gives itself the thread's
 * stack and thread-local storage, and runs the thread's entry point. Written from the WebAssembly
 * threads proposal (shared memory, one instance per thread, globals per instance) and emscripten's
 * documented thread model (a thread block per thread, set with `_emscripten_thread_init`).
 */
import { EngineError } from '../../../sdk-core/src/contracts/cache.ts';

/** The exports of the threaded module a thread's set-up reads. */
interface ThreadExports {
  __indirect_function_table: WebAssembly.Table;
  jolt_thread_stack(thread: number, top: number): number;
  _emscripten_thread_init(
    thread: number,
    isMainBrowserThread: number,
    isRuntimeThread: number,
    canBlock: number,
    defaultStackBytes: number,
    profile: number,
  ): void;
  _emscripten_tls_init(): number;
  emscripten_stack_set_limits(top: number, low: number): void;
  _emscripten_stack_restore(top: number): void;
}

/** Everything a new worker needs to run one of the module's threads. */
export interface JoltThreadStart {
  type: 'thread';
  module: WebAssembly.Module;
  memory: WebAssembly.Memory;
  /** The thread block `pthread_create` prepared, its stack bounds, its entry point and argument. */
  thread: number;
  top: number;
  low: number;
  entry: number;
  arg: number;
}

/** Starts a worker for one thread; the worker calls `runJoltThread` with the message. */
export type SpawnJoltThread = (start: JoltThreadStart) => void;

/** Stack of every thread the module starts (Jolt's jobs recurse through the collision queries). */
const THREAD_STACK_BYTES = 1024 * 1024;

/** The imports of either module; the threaded one adds its thread hooks. */
export function joltImports(
  memory: WebAssembly.Memory,
  exports: () => ThreadExports,
  threads: { module: WebAssembly.Module; count: number; spawn: SpawnJoltThread } | null,
) {
  const none = () => 0;
  const env: Record<string, unknown> = { memory, emscripten_notify_memory_growth: none };
  const wasi: Record<string, unknown> = {
    clock_time_get(_id: number, _precision: bigint, at: number) {
      new BigUint64Array(memory.buffer, at, 1)[0] = BigInt(Math.round(performance.now() * 1e6));
      return 0;
    },
  };
  if (threads) {
    Object.assign(env, {
      // Runs in `_initialize` on the stepping thread: it is a worker (no main browser thread),
      // the runtime thread, and may block on its jobs.
      _emscripten_init_main_thread_js(block: number) {
        exports()._emscripten_thread_init(block, 0, 1, 1, THREAD_STACK_BYTES, 0);
        exports()._emscripten_tls_init();
      },
      __pthread_create_js(thread: number, _attr: number, entry: number, arg: number) {
        const e = exports();
        const top = e.jolt_thread_stack(thread, 1),
          low = e.jolt_thread_stack(thread, 0);
        threads.spawn({
          type: 'thread',
          module: threads.module,
          memory,
          thread,
          top,
          low,
          entry,
          arg,
        });
        return 0;
      },
      emscripten_num_logical_cores: () => threads.count,
      // Thread exit, mailboxes and main-thread proxying: Jolt's pool never uses them (its threads
      // live as long as the world, and nothing is proxied), so they do nothing.
      emscripten_check_blocking_allowed: none,
      _emscripten_receive_on_main_thread_js: none,
      _emscripten_thread_mailbox_await: none,
      _emscripten_thread_set_strongref: none,
      _emscripten_notify_mailbox_postmessage: none,
      _emscripten_thread_cleanup: none,
      emscripten_exit_with_live_runtime: none,
    });
    wasi.proc_exit = (code: number) => {
      throw new Error(`PHYSICS_FAILED: module exit ${code}`);
    };
  }
  return { env, wasi_snapshot_preview1: wasi } as WebAssembly.Imports;
}

/** What a thread's worker posts once its instance is up, before it runs the thread. */
export const JOLT_THREAD_LOADED = { type: 'loaded' } as const;

/**
 * `openJolt`'s `threads`: `count` threads step the module, this one and its pool's, each a worker
 * of the script at `url` handed its start message (the script runs `runJoltThread` on it and posts
 * `JOLT_THREAD_LOADED`). A worker a worker starts loads only while its parent's event loop turns,
 * and a step blocks on its jobs: nothing steps before `ready()`, which resolves once every thread
 * spawned so far has loaded and rejects naming the first that did not, or a loaded one that
 * faulted meanwhile. A thread that throws, or posts its error, once `ready()` has resolved is named
 * to `failed`.
 */
export function joltWorkerPool(
  url: string | URL,
  count: number,
  failed: (error: EngineError) => void,
) {
  const loads: Promise<void>[] = [];
  let started = false;
  let broke!: (error: EngineError) => void;
  const broken = new Promise<never>((_, refused) => (broke = refused));
  broken.catch(() => {});
  const spawn: SpawnJoltThread = (start) => {
    const n = loads.length + 1;
    const named = (why: string) =>
      new EngineError('PHYSICS_FAILED', `Physics: pool thread ${n} ${why}`);
    const thread = new Worker(url, { type: 'module' });
    const load = new Promise<void>((loaded, refused) => {
      let up = false;
      const fault = (why: string) =>
        up
          ? (started ? failed : broke)(named(`failed: ${why}`))
          : refused(named(`did not load: ${why}`));
      thread.onerror = (event) => {
        // Handled here: not reported again as this worker's own uncaught error.
        event.preventDefault();
        fault(event.message || 'its script failed');
      };
      thread.onmessageerror = () => fault('a message could not be read');
      thread.onmessage = ({ data }) => {
        if (!up && data?.type === JOLT_THREAD_LOADED.type) {
          up = true;
          loaded();
        } else fault(String(data?.message ?? data));
      };
    });
    loads.push(load);
    thread.postMessage(start);
  };
  const ready = () =>
    Promise.race([Promise.all(loads), broken]).then(() => {
      started = true;
    });
  return { count, spawn, ready };
}

/**
 * Runs one of the module's threads in this worker, and never returns while the world lives;
 * `loaded` is called once its instance is up. The stack is set before any other call: until then
 * the instance's stack pointer is the stepping thread's, in the same memory.
 */
export async function runJoltThread(start: JoltThreadStart, loaded = () => {}) {
  let e: ThreadExports | null = null;
  const imports = joltImports(start.memory, () => e!, {
    module: start.module,
    count: 1,
    spawn: () => {
      throw new Error('PHYSICS_FAILED: a pool thread started a thread');
    },
  });
  const instance = await WebAssembly.instantiate(start.module, imports);
  e = instance.exports as unknown as ThreadExports;
  loaded();
  e.emscripten_stack_set_limits(start.top, start.low);
  e._emscripten_stack_restore(start.top);
  e._emscripten_thread_init(start.thread, 0, 0, 1, 0, 0);
  e._emscripten_tls_init();
  (e.__indirect_function_table.get(start.entry) as (arg: number) => number)(start.arg);
}

/**
 * Threads the step gets: the budget's, capped by the logical cores minus the page's own; one where
 * memory cannot be shared (a page that is not cross-origin isolated) or the cores are not reported.
 */
export function stepThreads(wanted: number) {
  const cores = navigator.hardwareConcurrency;
  if (!globalThis.crossOriginIsolated || !Number.isInteger(cores) || cores < 2) return 1;
  return Math.max(1, Math.min(Math.floor(wanted), cores - 1));
}
