import { compilingContract, wantsContractLighting } from '../pages/prepare/lightResources.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';

/** Wait for feedback, never capture image pixels or bypass frame admission budgets. */
export async function pendingWebgpuFrame(rt: WebgpuPagesRuntime) {
  const { run, gpu, vis, services } = rt;
  if (run.lost) throw new Error('WEBGPU_LOST');
  if (run.frameHeld) {
    // A held frame still waits for a contract program in flight: its arrival breaks the hold
    // (`onReady`) but asks no frame, and a loop gone idle would stay unlit (#536).
    const compiling = compilingContract(rt);
    if (!compiling) return false;
    await compiling.settle();
    return true;
  }
  await gpu.device?.queue.onSubmittedWorkDone();
  await run.gpuSelection?.flush();
  if (gpu.deferred && wantsContractLighting(rt)) await gpu.deferred.settle();
  await services.residency.pending;
  await vis.textures?.settled();
  if (run.lost) throw new Error('WEBGPU_LOST');
  return true;
}
