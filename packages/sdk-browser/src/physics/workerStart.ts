import { EngineError } from '../../../sdk-core/src/contracts/cache.ts'
import { PHYSICS_LAYOUT_VERSION } from '../../../sdk-core/src/physics/layout.ts'
import { checked } from '../cluster/checked.ts'
import { openJolt, startJolt } from './joltModule.ts'
import { joltWorkerPool } from './joltThreads.ts'
import type { FromPhysics, ToPhysics } from './protocol.ts'
import { createThreadTuner } from './threadTuner.ts'
import { createTickResults } from './tickResults.ts'

/** The worker's own scope: its script, which the module's threads run in too, and its post. */
type StartScope = {
  location: { href: string }
  postMessage(message: FromPhysics, transfer?: Transferable[]): void
}

/**
 * The physics module a `start` message names, opened in the worker `scope`: it resolves once each
 * of its threads has loaded — until then the worker steps nothing. With threads, a tuner splits
 * the steps over them; the results write into `buffers`, posted by the scope.
 */
export async function startPhysics(
  message: Extract<ToPhysics, { type: 'start' }>,
  scope: StartScope,
  buffers: ArrayBuffer[],
  fail: (error: unknown) => void,
) {
  if (message.protocol !== PHYSICS_LAYOUT_VERSION)
    throw new EngineError('PHYSICS_FAILED', 'Physics: protocol mismatch.')
  const response = await checked(message.wasm)
  const budget = message.budget
  const pool =
    message.threads > 1 ? joltWorkerPool(scope.location.href, message.threads, fail) : null
  const opened = await openJolt(await response.arrayBuffer(), budget.memoryBytes, pool)
  const jolt = startJolt(opened, budget, message.threads, message.step)
  await pool?.ready()
  return {
    jolt,
    tuner: pool ? createThreadTuner(message.threads, message.step) : null,
    results: createTickResults(jolt, budget, buffers, scope.postMessage.bind(scope)),
  }
}
