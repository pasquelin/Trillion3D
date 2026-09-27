import type { PageRec } from '../../page/selection/selection.ts';
import { createDenseKeySet } from '../cut/denseKeys.ts';
import type { createWebgpuPageTracking } from '../row/pageTracking.ts';

type Tracking = ReturnType<typeof createWebgpuPageTracking>;

/**
 * What the pin steps read of the image's sets, as differences since they last ran. The CPU cut's
 * (`pinUpdater.ts`) reads what joined and left `keep`; the GPU cut's (`requestPins.ts`) what
 * joined and left the upload queue. Only the step of the cut that decides is fed (#836): a switch
 * empties both, and the CPU cut's step, started afresh, sees every kept key join.
 */
export function createPinFeed(tracking: Pick<Tracking, 'keep' | 'keepPages'>) {
  /** Each key that joined `keep` beside the record it joined by (none for the pinned cover): the
   *  CPU cut's pin step reads its parents there. */
  const enteringPages: (PageRec | undefined)[] = [];
  const entering = createDenseKeySet(enteringPages),
    leaving = createDenseKeySet(),
    joined = createDenseKeySet(),
    left = createDenseKeySet();
  let cpuCut = true;
  return {
    entering,
    enteringPages,
    leaving,
    /** The GPU cut's queue changes: a key that joins then leaves between two steps is in neither. */
    wantedChanges: { joined, left },
    get byteLength() {
      return entering.byteLength + leaving.byteLength + joined.byteLength + left.byteLength;
    },
    kept(key: number, page?: PageRec) {
      if (!cpuCut) return;
      leaving.remove(key);
      entering.add(key, page);
    },
    unkept(key: number) {
      if (!cpuCut) return;
      entering.remove(key);
      leaving.add(key);
    },
    wanted(key: number, joins: boolean) {
      if (cpuCut) return;
      if (joins) {
        if (!left.remove(key)) joined.add(key);
      } else if (!joined.remove(key)) left.add(key);
    },
    /** The cut that decides from now on; true when it changed. */
    decideBy(cpu: boolean) {
      if (cpu === cpuCut) return false;
      cpuCut = cpu;
      entering.clear();
      leaving.clear();
      joined.clear();
      left.clear();
      const { keep, keepPages } = tracking;
      if (cpu) for (let i = 0; i < keep.count; i++) entering.add(keep.list[i], keepPages[i]);
      return true;
    },
  };
}
