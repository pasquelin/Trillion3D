import { wantsContractLighting } from '../pages/prepare/lightResources.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';

/** Wait for feedback, never capture image pixels or bypass frame admission budgets. */
export async function pendingWebgpuFrame(rt: WebgpuPagesRuntime) {
  const { run, setup, gpu, vis, services } = rt;
  if (run.lost) throw new Error('WEBGPU_LOST');
  if (run.frameHeld) return false;
  await setup.gpuDevice?.queue.onSubmittedWorkDone();
  await run.gpuSelection?.flush();
  if (gpu.deferred && wantsContractLighting(rt)) await gpu.deferred.settle();
  await services.residency.pending;
  await vis.textures?.settled();
  if (run.lost) throw new Error('WEBGPU_LOST');
  return true;
}
