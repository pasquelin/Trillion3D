import { grantPending } from '../../gpu/core/errorScope.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';

/** What the device still answers for the frame — its shadow pool, its targets —, while it answers:
 *  an image drawn meanwhile would be incomplete (#483), so the loop holds on it and a capture
 *  waits for it. Nothing is made while nothing is asked. */
export function deviceAnswer(rt: WebgpuPagesRuntime) {
  const shadows = grantPending(rt.lights.shadowGrant),
    targets = grantPending(rt.gpu.targetGrant);
  return shadows && targets ? Promise.all([shadows, targets]) : (shadows ?? targets);
}
