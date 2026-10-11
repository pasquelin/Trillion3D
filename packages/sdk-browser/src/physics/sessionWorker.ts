import type { PhysicsBudget } from '../../../sdk-core/src/physics/index.ts'
import { besideModule, startModuleWorker } from '../host/besideModule.ts'
import { stepThreads } from './joltThreads.ts'
import { PHYSICS_LAYOUT_VERSION } from '../../../sdk-core/src/physics/layout.ts'
import { resultWords } from './protocol.ts'

/** The physics worker, started on the module that fits the page (threaded when it can share
 *  memory) with the budget, the fixed step of `step` seconds and its two result buffers. Both the
 *  worker and its WebAssembly are named beside this module: it lies with them. */
export function startPhysicsWorker(budget: PhysicsBudget, step: number) {
  const worker = startModuleWorker(besideModule('physicsWorker', import.meta.url))
  const threads = stepThreads(budget.threads)
  const bytes = resultWords(budget) * 4
  const buffers = [new ArrayBuffer(bytes), new ArrayBuffer(bytes)]
  worker.postMessage(
    {
      type: 'start',
      protocol: PHYSICS_LAYOUT_VERSION,
      wasm: new URL(
        threads > 1 ? './joltPhysicsThreads.wasm' : './joltPhysics.wasm',
        import.meta.url,
      ).href,
      budget,
      threads,
      step,
      buffers,
    },
    buffers,
  )
  return worker
}
