// Worker side of the threaded contact proof: a page may not block on Jolt's jobs, a worker may.
// It steps the contact pile on the single-thread module, then on the threaded one, whose pool's
// threads run in workers of this same script (`runJoltThread`, as the physics worker runs them).
// A worker a worker starts loads only while its parent's event loop turns: the pile, which never
// yields, starts once every thread has said it loaded.
import { DEFAULT_PHYSICS_BUDGET } from '../../../packages/sdk-core/src/physics/index.ts';
import { openJolt, startJolt } from '../../../packages/sdk-browser/src/physics/joltModule.ts';
import {
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

const scope = globalThis as unknown as {
  onmessage:
    | ((
        event: MessageEvent<JoltThreadStart | { type: 'proof'; threads: number; steps: number }>,
      ) => void)
    | null;
  postMessage(message: ThreadedContacts | 'loaded'): void;
};

const MODULES = '../../../packages/sdk-browser/src/physics/';
/** The Node proof's budget: the pile's, in 64 MB (`startModule`). */
const BUDGET = { ...DEFAULT_PHYSICS_BUDGET, memoryBytes: 64 << 20, ...PILE_BUDGET };

/** A module stepped by `threads` threads, the threaded module's when more than one, once each
 *  of its threads has loaded. */
async function started(threads: number) {
  const file = threads > 1 ? 'joltPhysicsThreads.wasm' : 'joltPhysics.wasm';
  const bytes = await (await fetch(new URL(MODULES + file, import.meta.url))).arrayBuffer();
  const loaded: Promise<void>[] = [];
  const spawn = (start: JoltThreadStart) => {
    const thread = new Worker(import.meta.url, { type: 'module' });
    loaded.push(new Promise((done) => (thread.onmessage = () => done())));
    thread.onerror = (event) => scope.postMessage({ error: event.message || 'a thread failed' });
    thread.postMessage(start);
  };
  const pool = threads > 1 ? { count: threads, spawn } : null;
  const jolt = startJolt(await openJolt(bytes, BUDGET.memoryBytes, pool), BUDGET, threads);
  await Promise.all(loaded);
  return jolt;
}

scope.onmessage = async ({ data }) => {
  if (data.type === 'thread') {
    scope.postMessage('loaded');
    return runJoltThread(data);
  }
  try {
    const alone = pile(await started(1), data.steps);
    const jolt = await started(data.threads);
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
