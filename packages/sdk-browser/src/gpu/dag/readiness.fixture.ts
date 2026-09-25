import { createDagReadiness } from './readiness.ts';
import type { PackedDag } from './types.ts';

/** The cut rule's residency the kernel's host would upload for per-page residency `resident`, its
 *  node counts written into `packed` as the host writes them: what the oracle is handed. */
export function ruleResidency(packed: PackedDag, resident: ArrayLike<number>) {
  const readiness = createDagReadiness(packed);
  readiness.apply(resident);
  return { ready: readiness.ready, childReady: readiness.childReady };
}
