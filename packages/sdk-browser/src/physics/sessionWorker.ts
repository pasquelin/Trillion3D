import type { PhysicsBudget } from '../../../sdk-core/src/physics/index.ts';
import { besideModule } from '../host/besideModule.ts';
import { PHYSICS_PROTOCOL, resultWords } from './protocol.ts';

/**
 * Threads the step gets: the budget's, capped by the logical cores minus the page's own; one where
 * memory cannot be shared (a page that is not cross-origin isolated) or the cores are not reported.
 */
function stepThreads(wanted: number) {
  const cores = navigator.hardwareConcurrency;
  if (!globalThis.crossOriginIsolated || !Number.isInteger(cores) || cores < 2) return 1;
  return Math.max(1, Math.min(Math.floor(wanted), cores - 1));
}

/** The physics worker, started on the module that fits the page (threaded when it can share
 *  memory) with the budget and its two result buffers. */
export function startPhysicsWorker(budget: PhysicsBudget) {
  const worker = new Worker(besideModule('physicsWorker', import.meta.url), { type: 'module' });
  const threads = stepThreads(budget.threads);
  const bytes = resultWords(budget) * 4;
  const buffers = [new ArrayBuffer(bytes), new ArrayBuffer(bytes)];
  worker.postMessage(
    {
      type: 'start',
      protocol: PHYSICS_PROTOCOL,
      wasm: new URL(
        threads > 1 ? './joltPhysicsThreads.wasm' : './joltPhysics.wasm',
        import.meta.url,
      ).href,
      budget,
      threads,
      buffers,
    },
    buffers,
  );
  return worker;
}
