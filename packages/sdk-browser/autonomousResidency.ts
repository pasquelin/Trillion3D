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

/** Combien de pages portent leurs indices. Un comptage, pas un tableau intermédiaire de dizaines de
 *  milliers d'entrées alloué puis jeté à chaque relevé de métriques, c'est-à-dire à chaque image. */
export function comptePagesResidentes(pages: readonly PageRec[]) {
  let residentes = 0;
  for (let i = 0; i < pages.length; i++) if (pages[i].array) residentes++;
  return residentes;
}

export function createAutonomousResidency(env: ResidencyEnvironment) {
  const { bootstrapUrls, modifiedPages, shown, desired, pending, retained, byUrl, geometryStore } =
    env;
  const { detach } = geometryStore;
  const state = { cacheEvictions: 0 };
  // Deux ensembles pour la vie de l'hôte : une image les remplit et les vide, elle n'en alloue pas.
  const vues = new Set<string>(),
    uniques = new Set<string>();
  return {
    get cacheEvictions() {
      return state.cacheEvictions;
    },
    pendingUrls() {
      pending.length = 0;
      vues.clear();
      for (const rec of desired)
        if (!rec.array && !vues.has(rec.url)) {
          vues.add(rec.url);
          pending.push(rec.url);
        }
      return pending;
    },
    pageUrls() {
      retained.length = 0;
      uniques.clear();
      for (const url of bootstrapUrls) uniques.add(url);
      for (const url of modifiedPages) uniques.add(url);
      for (const rec of shown) uniques.add(rec.url);
      for (const rec of desired) uniques.add(rec.url);
      for (const url of uniques) retained.push(url);
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
