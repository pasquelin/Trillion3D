// The difference kernels' mirror (`shader/differenceWgsl.ts`): `dagCutDifference` and `dagCutKeep`
// on the readout's words, with a map where the kernels read each page's kept rank back off the kept
// list — what the GPU double replays (`tests/kit/gpu/mockCompute.ts`) and what the cut's tests take
// differences with. A page repeated in the kept list is named at one of its ranks: the last, here,
// as the last write of `dagCutKeep` may be.
import {
  KEPT_HEADER_WORDS,
  OUT_COUNT,
  SELECTION_HEADER_WORDS as HEAD,
  differenceWord,
  keptSnapshotWord,
} from './layout.ts';
import { requestPage } from './request.ts';
import { SELECTION_NONE } from '../core/selection.ts';

/** `list`'s difference against `kept`: the rank each page held there, or none. */
export function differenceOf(list: ArrayLike<number>, kept: ArrayLike<number>) {
  const rankOf = new Map(Array.from(kept, (page, rank) => [page, rank]));
  return Uint32Array.from(list, (page) => rankOf.get(page) ?? SELECTION_NONE);
}

/** The two lists a readout of `listCap` ranks carries, and the two it keeps behind their lengths
 *  (`keptSnapshotWord`). */
function listsOf(out: Uint32Array, listCap: number) {
  const drawnAt = HEAD + listCap,
    header = keptSnapshotWord(listCap),
    kept = header + KEPT_HEADER_WORDS;
  const span = (from: number, count: number) => Array.from(out.subarray(from, from + count));
  return [
    {
      now: span(HEAD, Math.min(out[OUT_COUNT], listCap)).map(requestPage),
      kept: span(kept, out[header]),
    },
    {
      now: span(drawnAt + HEAD, Math.min(out[drawnAt], listCap)),
      kept: span(kept + listCap, out[header + 1]),
    },
  ];
}

/** `dagCutDifference`: each list's ranks. */
export function writeDifference(out: Uint32Array, listCap: number) {
  const at = differenceWord(listCap);
  listsOf(out, listCap).forEach((list, l) =>
    out.set(differenceOf(list.now, list.kept), at + l * listCap),
  );
}

/** `dagCutKeep`: this snapshot's lists and their lengths become the kept ones. */
export function keepSnapshot(out: Uint32Array, listCap: number) {
  const [asked, drawn] = listsOf(out, listCap),
    kept = keptSnapshotWord(listCap);
  out.set([asked.now.length, drawn.now.length], kept);
  out.set(asked.now, kept + KEPT_HEADER_WORDS);
  out.set(drawn.now, kept + KEPT_HEADER_WORDS + listCap);
}
