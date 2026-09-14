import type { PageRec } from './pageSelection.ts';
import type { createAutonomousGeometry } from './autonomousGeometry.ts';

type ResidencyEnvironment = {
  bootstrapUrls: Set<string>;
  modifiedPages: Set<string>;
  shown: PageRec[];
  desired: PageRec[];
  pending: string[];
  retained: string[];
  byUrl: Map<string, PageRec[]>;
  geometryStore: ReturnType<typeof createAutonomousGeometry>;
};

export function createAutonomousResidency(env: ResidencyEnvironment) {
  const { bootstrapUrls, modifiedPages, shown, desired, pending, retained, byUrl, geometryStore } =
    env;
  const { detach } = geometryStore;
  const state = { cacheEvictions: 0 };
  return {
    get cacheEvictions() {
      return state.cacheEvictions;
    },
    pendingUrls() {
      pending.length = 0;
      for (const rec of desired)
        if (!rec.array && !pending.includes(rec.url)) pending.push(rec.url);
      return pending;
    },
    pageUrls() {
      retained.length = 0;
      const unique = new Set<string>([...bootstrapUrls, ...modifiedPages]);
      for (const rec of shown) unique.add(rec.url);
      for (const rec of desired) unique.add(rec.url);
      retained.push(...unique);
      return retained;
    },
    dropPage(url: string) {
      if (bootstrapUrls.has(url) || modifiedPages.has(url)) return;
      const recs = byUrl.get(url);
      if (!recs) return;
      for (const rec of recs) {
        detach(rec);
        if (rec.geometry) {
          geometryStore.state.allocationBytes -= rec.geometry.getIndex()?.array.byteLength ?? 0;
          for (const attr of Object.values(rec.geometry.attributes))
            geometryStore.state.allocationBytes -= attr.array.byteLength;
          rec.geometry.dispose();
        }
        rec.geometry = undefined;
        rec.mesh = undefined;
        rec.array = undefined;
        state.cacheEvictions++;
      }
    },
  };
}
