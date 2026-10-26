import { runCpuMethod } from '../../../../sdk-core/src/runtime/benchmarkProcessor.ts'
import type { WorkerScope } from '../host/workerScope.ts'

/**
 * Entry point of the hardware benchmark's worker (`hardwareBenchmark.ts`): each message names a
 * processor test, run once and timed here, off the page's thread; the answer is its measure.
 */
const scope = globalThis as unknown as WorkerScope<number, ReturnType<typeof runCpuMethod>>

scope.onmessage = (event) => scope.postMessage(runCpuMethod(event.data, 1, () => performance.now()))
