import type { createGpuPageCache } from './gpuPages.ts';
import type { createWebgpuDiagnostics } from './webgpuPagesDiagnostics.ts';
import type { createWebgpuPageTracking } from './webgpuPageTracking.ts';

type Cache = ReturnType<typeof createGpuPageCache>;
type MirrorOptions = {
  pageIndicesByUrl: Map<string, number[]>;
  residentOffsetWords: Int32Array;
  tracking: ReturnType<typeof createWebgpuPageTracking>;
  engineDiagnostic: ReturnType<typeof createWebgpuDiagnostics>['engineDiagnostic'];
  getCache: () => Cache | undefined;
  getFrame: () => number;
};

/** Tracks cache arrivals and departures, including transparent keys outside the row table. */
export function createWebgpuResidencyMirror(options: MirrorOptions) {
  const { pageIndicesByUrl, residentOffsetWords, tracking, engineDiagnostic, getCache, getFrame } =
    options;
  const residentOutsideTable = new Set<string>();
  const residencyKeys: string[] = [],
    residencySlots: number[] = [];
  let journalResident = 0;
  let dirty = true;

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
        pages = pageIndicesByUrl.get(key);
      const was = pages ? residentOffsetWords[pages[0]] >= 0 : residentOutsideTable.has(key);
      if (offsetWords >= 0 && !was) journalResident++;
      else if (offsetWords < 0 && was) journalResident--;
      if (!pages) {
        if (offsetWords >= 0) residentOutsideTable.add(key);
        else residentOutsideTable.delete(key);
        continue;
      }
      for (let i = 0; i < pages.length; i++) residentOffsetWords[pages[i]] = offsetWords;
    }
    const resident = cache.stats().residentPages;
    if (journalResident === resident) return;
    engineDiagnostic(
      'gpu-residency-mirror-rebuilt',
      'Miroir de résidence reconstruit depuis le cache',
      {
        frame: getFrame(),
        journal: journalResident,
        resident,
      },
    );
    dirty = true;
    journalResident = 0;
    residentOutsideTable.clear();
    for (const url of tracking.pageCatalog) {
      const page = cache.get(url),
        pages = pageIndicesByUrl.get(url);
      if (page) journalResident++;
      if (!pages) {
        if (page) residentOutsideTable.add(url);
        continue;
      }
      const offsetWords = page ? page.offset / 4 : -1;
      for (let i = 0; i < pages.length; i++) residentOffsetWords[pages[i]] = offsetWords;
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
