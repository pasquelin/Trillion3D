import type { PhysicsBudget } from '../../../sdk-core/src/physics/index.ts';
import { besideModule } from '../host/besideModule.ts';
import { stepThreads } from './joltThreads.ts';
import { PHYSICS_PROTOCOL, resultWords } from './protocol.ts';

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
