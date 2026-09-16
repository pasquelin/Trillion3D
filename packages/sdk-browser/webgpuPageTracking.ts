import type { PageRec } from './pageSelection.ts';
import { createDenseKeySet } from './webgpuDenseKeys.ts';

/** Adresses qu'un relevé de trace nomme, au plus, quelle que soit la taille de l'ensemble décrit. */
const TRACE_SAMPLE = 16;
/** Une liste d'enregistrements telle qu'un relevé la lit : la table de lignes en porte de vides. */
type PageList = ArrayLike<PageRec | undefined>;

/** Stable numeric page keys keep the hot residency path out of string hash tables. */
export function createWebgpuPageTracking(allPages: PageRec[]) {
  const pageCatalog = [...new Set(allPages.map((page) => page.url))];
  const pageCatalogIds = new Map(pageCatalog.map((url, index) => [url, index]));
  const pageRefs = (urls: string[]) => urls.map((url) => pageCatalogIds.get(url) ?? url);
  const keyCount = Math.max(1, pageCatalog.length);
  for (const page of allPages) page.keyIndex = pageCatalogIds.get(page.url);
  const keyOf = (rec: PageRec) => {
    const key = rec.keyIndex ?? pageCatalogIds.get(rec.url);
    if (key === undefined) throw new Error(`RESIDENCY_KEY_UNKNOWN: ${rec.url}`);
    rec.keyIndex = key;
    return key;
  };
  /**
   * The three sets the residency path carries from one image to the next. They are dense sets, not
   * per-image rebuilds: an image that changes no page touches none of them.
   * `wanted` is what the upload queue still has to fetch, `wantedPages` the record it fetches each key
   * by; `keep` is what the image forbids the cache to reclaim; `pinned` is what the cache actually
   * holds pinned for it.
   */
  const wantedPages: PageRec[] = [];
  const wanted = createDenseKeySet(keyCount, wantedPages);
  const keep = createDenseKeySet(keyCount);
  const pinned = createDenseKeySet(keyCount);
  /**
   * Keys something outside the residency path unpinned — a host page drop. The pin step drains this
   * and puts back the ones the image still keeps, so a dropped page that comes back is pinned again.
   */
  const unpinned: number[] = [];
  const markPinned = (key: number) => {
    pinned.add(key);
  };
  const unmarkPinned = (key: number) => {
    if (pinned.remove(key)) unpinned.push(key);
  };
  const traceSets = new Map<string, { revision: number; count: number; sample: string[] }>();
  /**
   * Un relevé de trace ne parcourt jamais une liste proportionnelle à la coupe ou au catalogue : il
   * publie le NOMBRE d'entrées, déjà tenu, et un sondage d'au plus `TRACE_SAMPLE` adresses réparties
   * régulièrement sur la liste. Comparer et recopier ce sondage borne le coût du mode trace, là où
   * la liste entière le rendait proportionnel à l'image — et allouait autant de tableaux par image.
   *
   * L'âge ne monte donc que sur un changement que le sondage voit ; c'est ce qu'un diagnostic borné
   * promet, et jamais l'inventaire exact d'un ensemble.
   */
  const scratch: string[] = [];
  const publish = (name: string, count: number, urlAt: (index: number) => string) => {
    const size = Math.min(count, TRACE_SAMPLE);
    scratch.length = 0;
    for (let k = 0; k < size; k++) scratch.push(urlAt(Math.floor((k * count) / size)));
    const previous = traceSets.get(name);
    const sampled = count > size;
    if (
      previous &&
      previous.count === count &&
      previous.sample.length === size &&
      previous.sample.every((url, index) => url === scratch[index])
    )
      return { revision: previous.revision, changed: false, count, sampled };
    const next = { revision: (previous?.revision ?? 0) + 1, count, sample: [...scratch] };
    traceSets.set(name, next);
    return {
      revision: next.revision,
      changed: true,
      count,
      sampled,
      pageIds: pageRefs(next.sample),
    };
  };
  const traceSet = (name: string, urls: readonly string[]) =>
    publish(name, urls.length, (index) => urls[index]);
  /** Le même relevé, tiré des enregistrements eux-mêmes : aucune liste d'adresses n'est construite
   *  pour lui. `count` borne la liste quand seul son début est valable, comme la table de lignes. */
  const traceRecs = (name: string, pages: PageList, count = pages.length) =>
    publish(name, count, (index) => pages[index]?.url ?? '');
  /** Le même relevé, tiré d'un ensemble dense de clés, sans en recopier une seule adresse. */
  const traceKeys = (name: string, set: { list: Int32Array; count: number }) =>
    publish(name, set.count, (index) => pageCatalog[set.list[index]]);
  return {
    pageCatalog,
    pageCatalogIds,
    pageRefs,
    keyCount,
    keyOf,
    wanted,
    wantedPages,
    keep,
    pinned,
    unpinned,
    markPinned,
    unmarkPinned,
    traceSets,
    traceSet,
    traceRecs,
    traceKeys,
  };
}
