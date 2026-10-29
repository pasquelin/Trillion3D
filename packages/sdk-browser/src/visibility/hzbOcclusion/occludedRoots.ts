import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'

/** The ranks of the roots the main view's last verdict found hidden behind the depth it drew (`hzbOcclusion.ts`), by runtime: none until a test came back. */
const found = new WeakMap<WebgpuPagesRuntime, { ranks: readonly number[]; revision: number }>()

/** The verdict while the roots are those it was made for (`rootIndex.revision`): ranks of another index name other roots. */
function stood(rt: WebgpuPagesRuntime) {
  const verdict = found.get(rt)
  return verdict?.revision === rt.layout.rootIndex.revision ? verdict.ranks : undefined
}

/** The roots the main view does not draw because the depth hides them, or none: the same array until the verdict changes. */
export const hzbOccludedRanks = (rt: WebgpuPagesRuntime): readonly number[] | undefined => stood(rt)

/** Puts `ranks` as the verdict (none clears it). */
export function setHzbOccludedRanks(rt: WebgpuPagesRuntime, ranks: readonly number[]) {
  if (ranks.length) found.set(rt, { ranks, revision: rt.layout.rootIndex.revision })
  else found.delete(rt)
}

/** The ranks a readback of verdicts (a word a root, non-zero where the test found the root behind the depth) names, in order. */
export function hiddenRanks(verdicts: ArrayLike<number>, roots: number) {
  const hidden: number[] = []
  for (let rank = 0; rank < roots; rank++) if (verdicts[rank]) hidden.push(rank)
  return hidden
}

/** Whether the ranks of `next` are those of `last`. */
export const sameRanks = (last: readonly number[], next: readonly number[]) =>
  last.length === next.length && last.every((rank, k) => rank === next[k])
