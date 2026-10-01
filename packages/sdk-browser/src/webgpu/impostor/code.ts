import { families } from '../../host/families.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';

/**
 * The impostor draw's code (`../../impostor/impostorCode.ts`), loaded on first use: asked by the
 * first image of a cache with baked impostors, never by another. `undefined` until it lands: the
 * image then plans no card and switches no root, so every root keeps its clusters, as one whose atlas is still
 * streaming does; the round over — arrived, or refused and told —, the session is asked a new
 * image (`resourcesChanged`), which draws the cards or asks again.
 */
export function impostorCode(rt: WebgpuPagesRuntime) {
  if (!rt.context.metadata.impostors?.baked) return undefined;
  return families.impostors.ask(rt, () => rt.run.gate.resourcesChanged());
}
