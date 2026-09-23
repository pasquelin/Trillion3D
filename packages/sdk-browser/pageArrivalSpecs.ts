import {
  PAGE_SLICE_STRIDE,
  PAGE_SPEC_STRIDE,
  SLICE_OFFSET_WORDS,
  SLICE_WORDS,
  SPEC_PAGE_INDEX,
  SPEC_STREAM_OFFSET,
  SPEC_TRIANGLES,
} from '../sdk-core/src/index.ts';
import type { ArrivalPlan } from './pageIntegrationHost.ts';

/** What a record owes the spec: its place in the bundle, its size, its page rank. */
type SpecRec = { streamOffset?: number; triangles: number };
/** What an arrival writes on a record: its view of the bundle and what it weighs. */
type ArrivalRec = SpecRec & { array?: Uint32Array; indexBytes: number };

/**
 * Spec of a request: three integers per record, taken from the catalogue alone.
 *
 * It depends on no arrival — offset in the bundle, triangles and page rank are set by the
 * compiler and by the page table — so it is built once per address and re-read afterwards. That
 * is all the off-thread worker receives: the page's bytes stay with their owner.
 */
export function createArrivalSpecs<T extends SpecRec>(
  byUrl: ReadonlyMap<string, T[]>,
  pageIndexOf: (rec: T) => number | undefined,
) {
  const cache = new Map<string, Int32Array>();
  return (url: string) => {
    const known = cache.get(url);
    if (known) return known;
    const recs = byUrl.get(url);
    if (!recs) return undefined;
    const specs = new Int32Array(recs.length * PAGE_SPEC_STRIDE);
    for (let i = 0; i < recs.length; i++) {
      const rec = recs[i],
        spec = i * PAGE_SPEC_STRIDE;
      specs[spec + SPEC_STREAM_OFFSET] = rec.streamOffset ?? -1;
      specs[spec + SPEC_TRIANGLES] = rec.triangles;
      specs[spec + SPEC_PAGE_INDEX] = pageIndexOf(rec) ?? -1;
    }
    cache.set(url, specs);
    return specs;
  };
}

/**
 * Sets an arrival's views from its plan, without recomputing a single one.
 *
 * The plan names, for each record and in spec order, its first word and its word count: the loop
 * only sets the view. Returns false when no plan arrived or it does not describe this list — the
 * caller then redoes the original computation, at the same result. A plan that would overflow the
 * arrived bundle is refused the same way.
 */
export function applyArrivalPlan<T extends ArrivalRec>(
  recs: readonly T[],
  array: Uint32Array,
  plan: ArrivalPlan | undefined,
) {
  if (!plan || plan.count !== recs.length) return false;
  const { slices } = plan;
  for (let i = 0; i < recs.length; i++) {
    const slice = i * PAGE_SLICE_STRIDE,
      from = slices[slice + SLICE_OFFSET_WORDS],
      words = slices[slice + SLICE_WORDS];
    if (from + words > array.length) return false;
    const view = from === 0 && words === array.length ? array : array.subarray(from, from + words);
    recs[i].array = view;
    recs[i].indexBytes = view.byteLength;
  }
  return true;
}
