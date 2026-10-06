import { gpuDeviceLedgerOf } from '../../gpu/core/deviceLedger.ts'
import { grantPending } from '../../gpu/core/errorScope.ts'
import { pipelinesCompiling, pipelinesSettled } from '../../lighting/deferred/fullscreen.ts'
import { litProgramPending } from '../pages/prepare/lightResources.ts'
import { askFramePipelines } from './framePipelines.ts'
import type { WebgpuPagesRuntime } from '../pages/runtime.ts'

/** What the device still answers for the frame — its targets, the lit program it compiles, the
 *  pipelines the next frame binds (`askFramePipelines`, asked here as a frame entry asks them) —,
 *  while it answers: an image drawn meanwhile would be incomplete (#483) or unlit (#1362), or
 *  compile on the frame, so the loop holds on it and a capture waits for it. Nothing is made while
 *  nothing is asked. */
export function deviceAnswer(rt: WebgpuPagesRuntime) {
  const refusal = gpuDeviceLedgerOf(rt.gpu.device)?.refusal
  if (refusal) return Promise.reject(refusal)
  askFramePipelines(rt)
  if (!deviceAnswering(rt)) return undefined
  const answers = [
    grantPending(rt.gpu.targetGrant),
    litProgramPending(rt),
    pipelinesSettled(rt.gpu.device, true),
  ].filter((answer) => answer !== undefined)
  return Promise.all(answers)
}

/** Whether `deviceAnswer` has an answer in flight, read without allocating: the held frame asks it
 *  every frame. The same answers, kept side by side. */
export const deviceAnswering = (rt: WebgpuPagesRuntime) =>
  !!gpuDeviceLedgerOf(rt.gpu.device)?.refusal ||
  grantPending(rt.gpu.targetGrant) !== undefined ||
  litProgramPending(rt) !== undefined ||
  pipelinesCompiling(rt.gpu.device)
