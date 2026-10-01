import { families } from '../host/families.ts';
import type { BackendContext } from '../backend/types.ts';

/**
 * The impostor draw's code (`impostorCode.ts`), a family on demand (#1335, #1336), the one load
 * path of both renderers: imported by a session whose cache has baked impostors, and awaited where
 * it prepares — the WebGPU pages' (`preparePages.ts`), the WebGL2 tier's (`../webgl/impostor/code.ts`)
 * —, as deformation's and transmission's are, so its first image already draws the cards; never by
 * another. A refused import (`FAMILY_LOAD_FAILED`, told by the loader) is no refused scene: without
 * its code the session plans no card, and every root keeps its clusters, as one whose atlas still
 * streams.
 */
export const loadImpostorCode = (context: Pick<BackendContext, 'metadata'>) =>
  context.metadata.impostors?.baked
    ? families.impostors.load().catch(() => undefined)
    : Promise.resolve(undefined);
