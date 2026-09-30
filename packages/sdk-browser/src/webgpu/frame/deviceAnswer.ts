import { gpuDeviceLedgerOf } from '../../gpu/core/deviceLedger.ts';
import { grantPending } from '../../gpu/core/errorScope.ts';
import { litProgramPending } from '../pages/prepare/lightResources.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';

/** What the device still answers for the frame — its shadow pool, its targets, the lit program it
 *  compiles —, while it answers: an image drawn meanwhile would be incomplete (#483) or unlit
 *  (#1362), so the loop holds on it and a capture waits for it. Nothing is made while nothing is
 *  asked. */
export function deviceAnswer(rt: WebgpuPagesRuntime) {
  const refusal = gpuDeviceLedgerOf(rt.gpu.device)?.refusal;
  if (refusal) return Promise.reject(refusal);
  const answers = [
    grantPending(rt.lights.shadowGrant),
    grantPending(rt.gpu.targetGrant),
    litProgramPending(rt),
  ].filter((answer) => answer !== undefined);
  return answers.length ? Promise.all(answers) : undefined;
}

/** Whether `deviceAnswer` has an answer in flight, read without allocating: the held frame asks it
 *  every frame. The same answers, kept side by side. */
export const deviceAnswering = (rt: WebgpuPagesRuntime) =>
  !!gpuDeviceLedgerOf(rt.gpu.device)?.refusal ||
  grantPending(rt.lights.shadowGrant) !== undefined ||
  grantPending(rt.gpu.targetGrant) !== undefined ||
  litProgramPending(rt) !== undefined;
