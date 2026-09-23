import type { PageRec } from '../../page/selection/selection.ts';

/**
 * The address one pool slot is held, pinned and read under, for one cluster record.
 *
 * Index pages are CONTENT-addressed: two primitives whose clusters carry the same index bytes
 * share one index-page url while each keeps a quantized geometry page of its own. The address is
 * therefore the geometry page's url wherever the record carries one, and the index page's url
 * otherwise — two such clusters take two slots and each decodes its own page, where one address
 * would have had one of them decode the other's bytes.
 *
 * A transparent placement carries no geometry page (`../../page/selection/collect.ts`) and its forward draw
 * reads INDEX words out of its slot (`../transparent/spans.ts`, then `indices[base+local]` in
 * `../blend/shader.ts`): it sits at the index address and is served the index page, while the
 * opaque record of the same primitive keeps its page at that page's own address. Neither gives
 * anything up for the two to coexist.
 */
export const pageAddress = (rec: PageRec) => rec.geometryPage?.url ?? rec.url;

/**
 * What the geometry pool holds for the scene, walked once from the catalogue.
 *
 * A slot holds a cluster's quantized geometry page where the cache carries one, its index page
 * otherwise, and it is as wide as the widest of them, so any admitted page fits. That width is a
 * BYTE count and says nothing about how many corners a cluster draws: a page under twelve packed
 * bytes per triangle is narrower than its own corner list. The draw ceiling is therefore the
 * catalogue's largest corner count, taken here and nowhere else — a draw bounded by the slot's
 * word count would silently drop the tail triangles of every cluster the format compresses well.
 *
 * The slot's content is chosen per cluster ADDRESS (`geometryUrls`), while the row's
 * `FLAG_CLUSTER_PAGE` is decided per RECORD (`pageRowMaterial.ts`, from `rec.geometryPage`).
 * Two records at one address that disagreed would make one row decode index words as a page, and
 * `pageAddress` makes that impossible: a record's page is part of its address. The refusal below is
 * that invariant said out loud, on the one walk where both sides are read together.
 */
export function describePageSlots(allPages: readonly PageRec[]) {
  const geometryUrls = new Map<string, string>(),
    seenUrls = new Set<string>();
  let pageBytes = 4,
    maxCorners = 1,
    fromGeometryPage = 0,
    fromSourceGeometry = 0,
    transparentClusters = 0;
  for (const page of allPages) {
    const geometry = page.geometryPage,
      address = pageAddress(page);
    if (seenUrls.has(address) && geometryUrls.get(address) !== geometry?.url)
      throw new Error(`CLUSTER_PAGE_DISAGREEMENT: ${address}`);
    seenUrls.add(address);
    if (geometry) {
      geometryUrls.set(address, geometry.url);
      fromGeometryPage++;
    } else if (page.transparent) transparentClusters++;
    else fromSourceGeometry++;
    const n = geometry ? geometry.bytes : (page.array?.byteLength ?? page.indexBytes);
    const padded = n + (n % 4 ? 4 - (n % 4) : 0);
    if (padded > pageBytes) pageBytes = padded;
    const corners = geometry ? geometry.indexCount : page.triangles * 3;
    if (corners > maxCorners) maxCorners = corners;
  }
  return {
    geometryUrls,
    pageBytes,
    maxCorners,
    fromGeometryPage,
    fromSourceGeometry,
    transparentClusters,
  };
}

/**
 * True while this cluster still waits for bytes it cannot draw without.
 *
 * A cluster the cache gave a quantized geometry page draws from that page alone: the pool reads it
 * at the cluster's own address (`../pages/services.ts`) and the shaders decode it in place. Its
 * index page is never requested, never downloaded and never held on the CPU — the only number the
 * row ever wanted from it, the corner count, the geometry page declares itself.
 */
export const awaitsPageBytes = (rec: PageRec) => !rec.geometryPage && !rec.array;

/** The records of `pages` whose bytes are still awaited, collected into `into`: what the host is
 *  asked to fetch, and what an image is still missing. */
export function awaitedPages(pages: readonly PageRec[], into: PageRec[]) {
  into.length = 0;
  for (let i = 0; i < pages.length; i++) if (awaitsPageBytes(pages[i])) into.push(pages[i]);
  return into;
}
