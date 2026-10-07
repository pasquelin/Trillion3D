// The difference kernels' mirror (`shader/differenceWgsl.ts`): each list's difference and keep
// on the readout's words, with a map where the kernels read each page's kept rank back off the kept
// list — what the GPU double replays (`tests/kit/gpu/mockCompute.ts`) and what the cut's tests take
// differences with. A page repeated in the kept list is named at one of its ranks: the last, here,
// as the last write of a keep kernel may be.
import {
  KEPT_HEADER_WORDS,
  OUT_COUNT,
  SELECTION_HEADER_WORDS as HEAD,
  differenceWord,
  keptSnapshotWord,
} from './layout.ts'
import { SELECTION_NONE } from '../core/selection.ts'
import { DIFFERENCE_STAGES, KEEP_STAGES } from './shader/differenceWgsl.ts'

/** `list`'s difference against `kept`: the rank each page held there, or none. */
export function differenceOf(list: ArrayLike<number>, kept: ArrayLike<number>) {
  const rankOf = new Map(Array.from(kept, (page, rank) => [page, rank]))
  return Uint32Array.from(list, (page) => rankOf.get(page) ?? SELECTION_NONE)
}

/** The two lists a readout of `listCap` ranks carries, and the two it keeps behind their lengths
 *  (`keptSnapshotWord`). */
function listsOf(out: Uint32Array, listCap: number) {
  const drawnAt = HEAD + listCap,
    header = keptSnapshotWord(listCap),
    kept = header + KEPT_HEADER_WORDS
  const span = (from: number, count: number) => Array.from(out.subarray(from, from + count))
  return [
    {
      now: span(HEAD, Math.min(out[OUT_COUNT], listCap)),
      kept: span(kept, out[header]),
    },
    {
      now: span(drawnAt + HEAD, Math.min(out[drawnAt], listCap)),
      kept: span(kept + listCap, out[header + 1]),
    },
  ]
}

/** The difference kernels: each list's ranks. */
function writeDifference(out: Uint32Array, listCap: number) {
  const at = differenceWord(listCap)
  listsOf(out, listCap).forEach((list, l) =>
    out.set(differenceOf(list.now, list.kept), at + l * listCap),
  )
}

/** The keep kernels: this snapshot's lists and their lengths become the kept ones. */
function keepSnapshot(out: Uint32Array, listCap: number) {
  const [asked, drawn] = listsOf(out, listCap),
    kept = keptSnapshotWord(listCap)
  out.set([asked.now.length, drawn.now.length], kept)
  out.set(asked.now, kept + KEPT_HEADER_WORDS)
  out.set(drawn.now, kept + KEPT_HEADER_WORDS + listCap)
}

/** Every kernel of the difference: each list's, then each list's keep. */
export const DIFFERENCE_KERNELS: readonly string[] = [...DIFFERENCE_STAGES, ...KEEP_STAGES]

/** The mirror of kernel `stage` on `out`, true when it is one of the difference kernels: both lists
 *  at once on the first list's, which run before the second's (`../encode.ts`). */
export function mirrorDifferenceStage(stage: string, out: Uint32Array, listCap: number) {
  if (stage === DIFFERENCE_STAGES[0]) writeDifference(out, listCap)
  else if (stage === KEEP_STAGES[0]) keepSnapshot(out, listCap)
  return DIFFERENCE_KERNELS.includes(stage)
}
