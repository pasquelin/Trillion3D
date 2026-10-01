import { families } from '../../host/families.ts';
import type { EngineCamera } from '../../camera/world.ts';
import type { WebglCards } from './pass.ts';
import type { WebglImpostors, createWebglImpostors } from './frame.ts';

/**
 * THE WEBGL2 IMPOSTOR TIER, ITS CODE LOADED ON FIRST USE (#1336), as the WebGPU draw's
 * (`../../webgpu/impostor/code.ts`): the tier (`frame.ts`) is made from the impostor family
 * (`../../impostor/impostorCode.ts`) by the first image of a cache with baked impostors, never by
 * another, so the CDN core stays within its budget. Until it lands, the image plans no card and
 * switches no root: every root keeps its clusters, as one whose atlas is still streaming does; the
 * round over — arrived, or refused and told —, the session is asked a new image
 * (`resourcesChanged`), which plans the cards or asks again. A cache without baked impostors makes
 * nothing.
 */
export function webglImpostorTier(...args: Parameters<typeof createWebglImpostors>) {
  const [context, , gate] = args;
  if (!context.metadata.impostors?.baked) return undefined;
  // `null` once made without one: no level reader or no context.
  let tier: WebglImpostors | null | undefined,
    waiting = false;
  const cards: WebglCards = (...draw) => tier?.cards(...draw) ?? false;
  return {
    cards,
    /** The image's plan at `cam` for `viewport`, before its cut, once the code has landed. */
    plan(cam: EngineCamera, viewport: readonly number[] | undefined) {
      if (tier === undefined) {
        const code = families.impostors.get();
        if (code) tier = code.createWebglImpostors(...args) ?? null;
        else if (!waiting) {
          waiting = true;
          void families.impostors.settled().then(() => {
            waiting = false;
            gate.resourcesChanged();
          });
        }
      }
      tier?.plan(cam, viewport);
    },
    dispose: () => tier?.dispose(),
  };
}
