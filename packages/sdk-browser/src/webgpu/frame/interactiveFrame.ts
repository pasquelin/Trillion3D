import { compilingContract, wantsContractLighting } from '../pages/prepare/lightResources.ts';
import { shadowPoolPending } from '../shadow/poolSize.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';

/** Wait for feedback, never capture image pixels or bypass frame admission budgets. */
export async function pendingWebgpuFrame(rt: WebgpuPagesRuntime) {
  const { run, gpu, vis, services } = rt;
  if (run.lost) throw new Error('WEBGPU_LOST');
  // A shadow pool the device is still answering for: its answer asks a frame, held or not.
  const shadowPool = shadowPoolPending(rt);
  if (shadowPool) {
    await shadowPool;
    return true;
  }
  if (run.frameHeld) {
    // A held frame still waits for a contract program in flight: its arrival breaks the hold
    // (`onReady`) but asks no frame, and a loop gone idle would stay unlit (#536). A failed
    // compile announces nothing and changes nothing: the loop stays idle, no held frame redrawn.
    const compiling = compilingContract(rt);
    if (!compiling) return false;
    const { revisions } = run.gate,
      resources = revisions.resources;
    await compiling.settle();
    return revisions.resources !== resources;
  }
  await gpu.device?.queue.onSubmittedWorkDone();
  await run.gpuSelection?.flush();
  if (gpu.deferred && wantsContractLighting(rt)) await gpu.deferred.settle();
  await services.residency.pending;
  await vis.textures?.settled();
  // An image drawn while the effect programs compile is drawn again once, when they arrive,
  // rather than on every frame meanwhile, which would spend the loop's rounds (#349). Waited
  // last: the feedback above is not held back by a compilation.
  await gpu.effects?.settled();
  if (run.lost) throw new Error('WEBGPU_LOST');
  return true;
}
