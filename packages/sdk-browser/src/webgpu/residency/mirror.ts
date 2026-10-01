import type { createGpuPageCache } from '../../gpu/page/pages.ts';
import type { createWebgpuDiagnostics } from '../pages/io/diagnostics.ts';
import type { createWebgpuPageTracking } from '../row/pageTracking.ts';
import type { PackedInstances } from '../row/instances.ts';

type Cache = ReturnType<typeof createGpuPageCache>;
type MirrorOptions = {
  /** Packed ranks by pool address, and each rank's slot: read live, as pages join in place. */
  table: {
    readonly instances: Pick<PackedInstances, 'each' | 'first'>;
    readonly residentOffsetWords: Int32Array;
  };
  tracking: ReturnType<typeof createWebgpuPageTracking>;
  engineDiagnostic: ReturnType<typeof createWebgpuDiagnostics>['engineDiagnostic'];
  getCache: () => Cache | undefined;
  getFrame: () => number;
  onOffsetChange?: (page: number, offset: number) => void;
};

/** Tracks cache arrivals and departures, including transparent keys outside the row table. */
export function createWebgpuResidencyMirror(options: MirrorOptions) {
  const { table, tracking, engineDiagnostic, getCache, getFrame } = options;
  const residentOutsideTable = new Set<string>();
  const residencyKeys: string[] = [],
    residencySlots: number[] = [];
  let journalResident = 0;
  let dirty = true;

  let offset = -1;
  const setOffset = (page: number) => {
    const { residentOffsetWords } = table;
    if (residentOffsetWords[page] === offset) return;
    residentOffsetWords[page] = offset;
    options.onOffsetChange?.(page, offset);
  };
  /** Every packed rank at `key` takes slot `words`; false when the table holds none. */
  const setOffsets = (key: string, words: number) => {
    offset = words;
    return table.instances.each(key, setOffset);
  };

  const sync = () => {
    const cache = getCache();
    if (!cache) return;
    residencyKeys.length = 0;
    residencySlots.length = 0;
    cache.drainResidencyChanges(residencyKeys, residencySlots);
    if (residencyKeys.length) dirty = true;
    for (let c = 0; c < residencyKeys.length; c++) {
      const key = residencyKeys[c],
        offsetWords = residencySlots[c],
        first = table.instances.first(key);
      const was =
        first !== undefined ? table.residentOffsetWords[first] >= 0 : residentOutsideTable.has(key);
      if (offsetWords >= 0 && !was) journalResident++;
      else if (offsetWords < 0 && was) journalResident--;
      if (setOffsets(key, offsetWords)) continue;
      if (offsetWords >= 0) residentOutsideTable.add(key);
      else residentOutsideTable.delete(key);
    }
    const resident = cache.stats().residentPages;
    if (journalResident === resident) return;
    engineDiagnostic('gpu-residency-mirror-rebuilt', 'Residency mirror rebuilt from the cache', {
      frame: getFrame(),
      journal: journalResident,
      resident,
    });
    dirty = true;
    journalResident = 0;
    residentOutsideTable.clear();
    for (const url of tracking.pageCatalog) {
      const page = cache.get(url);
      if (page) journalResident++;
      if (!setOffsets(url, page ? page.offset / 4 : -1) && page) residentOutsideTable.add(url);
    }
  };

  return {
    sync,
    get dirty() {
      return dirty;
    },
    set dirty(value: boolean) {
      dirty = value;
    },
  };
}
