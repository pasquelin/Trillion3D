import { loadImpostorCode } from '../../impostor/code.ts';
import * as lent from './lent.ts';
import type { EngineCamera } from '../../camera/world.ts';
import type { WebglCards } from './pass.ts';
import type { WebglImpostors, createWebglImpostors } from './frame.ts';

/**
 * THE WEBGL2 IMPOSTOR TIER, ITS CODE A FAMILY ON DEMAND (#1336), loaded as the WebGPU draw's
 * (`../../impostor/code.ts`): the tier (`frame.ts`) is made from the impostor family by the
 * backend's prepare of a cache with baked impostors, awaited beside its pages, so its first image
 * already plans and draws the cards, and the CDN core stays within its budget; the core lends it
 * the cluster program's pieces (`lent.ts`). A cache without baked impostors makes nothing; a
 * refused import makes no tier: every root keeps its clusters.
 */
export function webglImpostorTier(...args: Parameters<typeof createWebglImpostors>) {
  const [context] = args;
  if (!context.metadata.impostors?.baked) return undefined;
  let tier: WebglImpostors | undefined,
    disposed = false;
  const cards: WebglCards = (camera, lights, pass, linear) =>
    tier?.cards(camera, lights, pass, linear) ?? false;
  return {
    cards,
    /** GPU bytes of the atlases held: none until the tier is made. */
    bytes: () => tier?.bytes ?? 0,
    /** Loads the code and makes the tier, before the first image; none once disposed. */
    async prepare() {
      const code = await loadImpostorCode(context, lent);
      if (!disposed) tier = code?.createWebglImpostors(...args);
    },
    /** The image's plan at `cam` for `viewport`, before its cut. */
    plan: (cam: EngineCamera, viewport: readonly number[] | undefined) => tier?.plan(cam, viewport),
    dispose() {
      disposed = true;
      tier?.dispose();
    },
  };
}
