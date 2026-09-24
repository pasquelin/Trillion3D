import type { Primitive } from '../../../../sdk-core/src/index.ts';
import type { PageRec } from './types.ts';

const NONE: readonly PageRec[] = [];

/**
 * The compiled install order, read once per placement: each record receives, as `dependencies`, one
 * record of every streaming bundle its own bundle lists (`streams.pages[].dependencies`,
 * `docs/FORMAT.md`) and whose bytes a cluster draws from. A bundle's clusters receive their bytes
 * together, so one record of it says whether the bundle is there and under which request it is
 * fetched. A bundle whose clusters all read a quantized geometry page is never fetched
 * (`awaitsPageBytes`, `../../webgpu/row/pageSlots.ts`), so it is not listed. The list is shared by every record of the bundle, and a
 * bundle that depends on nothing — the root cover — shares an empty one.
 *
 * `recs` are the records of one placement, in the order of `primitive.pages`.
 */
export function linkBundleDependencies(primitive: Primitive, recs: readonly PageRec[]) {
  const bundles = primitive.streams?.pages;
  if (!bundles?.length) return;
  const fetched: PageRec[] = [];
  primitive.pages.forEach((page, index) => {
    const rec = recs[index];
    if (typeof page.stream === 'number' && !rec.geometryPage) fetched[page.stream] ??= rec;
  });
  const lists = bundles.map((bundle) => {
    const records = (bundle.dependencies ?? []).flatMap((dependency) => fetched[dependency] ?? []);
    return records.length ? records : NONE;
  });
  primitive.pages.forEach((page, index) => {
    if (typeof page.stream === 'number') recs[index].dependencies = lists[page.stream];
  });
}

/**
 * Marks a cut, then the bundles it is installed after: what the host keeps retained with the cut,
 * so a parent fetched for a cut page is not evicted before that page can follow it.
 */
export function withClosure<T extends { dependencies?: readonly T[] }>(
  cut: readonly T[],
  mark: (list: readonly T[]) => unknown,
) {
  mark(cut);
  for (let i = 0; i < cut.length; i++) {
    const dependencies = cut[i].dependencies;
    if (dependencies?.length) mark(dependencies);
  }
}
