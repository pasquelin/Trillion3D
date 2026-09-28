// Worker side of the threaded contact proof: a page may not block on Jolt's jobs, a worker may.
// It steps the contact pile on the single-thread module, then on the threaded one, whose pool's
// threads run in workers of this same script (`joltWorkerPool`, as the physics worker runs them):
// the pile, which never yields, starts once the pool is ready.
import { DEFAULT_PHYSICS_BUDGET } from '../../../packages/sdk-core/src/physics/index.ts';
import { openJolt, startJolt } from '../../../packages/sdk-browser/src/physics/joltModule.ts';
import {
  JOLT_THREAD_LOADED,
  joltWorkerPool,
  runJoltThread,
  type JoltThreadStart,
} from '../../../packages/sdk-browser/src/physics/joltThreads.ts';
import {
  pile,
  PILE_BUDGET,
  type PileStep,
} from '../../../packages/sdk-browser/src/physics/contactPile.fixture.ts';

/** What the proof reads back: the pile on each module, or the error that stopped it. */
export type ThreadedContacts =
  { isolated: boolean; threads: number; alone: PileStep[]; pooled: PileStep[] } | { error: string };

/** A pool thread's start, or the proof's order. */
type Order = JoltThreadStart | { type: 'proof'; threads: number; steps: number };

const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<Order>) => void) | null;
  postMessage(message: ThreadedContacts | typeof JOLT_THREAD_LOADED): void;
};

const MODULES = '../../../packages/sdk-browser/src/physics/';
/** The Node proof's budget (`startModule`). */
const BUDGET = { ...DEFAULT_PHYSICS_BUDGET, ...PILE_BUDGET };

/** A module's bytes; a module not served is named. */
async function bytesOf(file: string) {
  const response = await fetch(new URL(MODULES + file, import.meta.url));
  if (!response.ok) throw new Error(`${file}: ${response.status}`);
  return response.arrayBuffer();
}

/** A module stepped by `threads` threads, the threaded module's when more than one, once its
 *  pool is ready. */
async function started(threads: number, bytes: ArrayBuffer) {
  const relay = (data: unknown) => scope.postMessage({ error: (data as Error).message });
  const pool = threads > 1 ? joltWorkerPool(import.meta.url, threads, relay) : null;
  const opened = await openJolt(bytes, BUDGET.memoryBytes, pool);
  const jolt = startJolt(opened, BUDGET, threads);
  await pool?.ready();
  return jolt;
}

scope.onmessage = async ({ data }) => {
  if (data.type === 'thread')
    return runJoltThread(data, () => scope.postMessage(JOLT_THREAD_LOADED));
  try {
    // Both modules fetched at once: the threaded one's bytes arrive while the first pile runs.
    const [one, many] = [bytesOf('joltPhysics.wasm'), bytesOf('joltPhysicsThreads.wasm')];
    const alone = pile(await started(1, await one), data.steps);
    const jolt = await started(data.threads, await many);
    const threads = jolt.concurrency(data.threads);
    scope.postMessage({
      isolated: crossOriginIsolated,
      threads,
      alone,
      pooled: pile(jolt, data.steps),
    });
  } catch (error) {
    scope.postMessage({ error: String(error) });
  }
};
