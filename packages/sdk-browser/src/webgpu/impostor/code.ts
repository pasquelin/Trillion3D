import { families } from '../../host/families.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';

/** The sessions waiting for the impostor draw's arrival, each told once per round. */
const waiting = new WeakSet<WebgpuPagesRuntime>();

/**
 * The impostor draw's code (`impostorCode.ts`), loaded on first use: asked by the first image of a
 * cache with baked impostors, never by another. `undefined` until it lands: the image then plans no
 * card and switches no root, so every root keeps its clusters, as one whose atlas is still
 * streaming does; the round over — arrived, or refused and told —, the session is asked a new
 * image (`resourcesChanged`), which draws the cards or asks again.
 */
export function impostorCode(rt: WebgpuPagesRuntime) {
  if (!rt.context.metadata.impostors?.baked) return undefined;
  const code = families.impostors.get();
  if (code || waiting.has(rt)) return code;
  waiting.add(rt);
  void families.impostors.settled().then(() => {
    waiting.delete(rt);
    rt.run.gate.resourcesChanged();
  });
  return undefined;
}
