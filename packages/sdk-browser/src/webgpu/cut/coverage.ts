import type { PageRec } from '../../page/selection/selection.ts';
import type { CutPending } from './pending.ts';
import type { HeldResidency } from '../../page/cut/held.ts';

/**
 * What the rank journal notifies when a page changes coverage: the pending set, and the CPU cut's
 * readiness of its placement — read back through the one catalogue accessor, `recordOf`. Kept
 * outside publication so that a closure taken inside would not hold its whole context there.
 */
export const coverageWatcher =
  (pending: CutPending, held: HeldResidency, recordOf: (packed: number) => PageRec | undefined) =>
  (page: number) => {
    pending.touch(page);
    const rec = recordOf(page);
    if (rec) held.moved(rec);
  };
