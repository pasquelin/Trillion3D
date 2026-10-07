// The double's kernels over the cut's lists, the readout and the journals: each kept list's
// difference and keep (`gpu/dag/difference.fixture.ts`), and the mask swap
// (`gpu/dag/shader/swapWgsl.ts`). The double's `dagMask` writes the whole mask and keeps no journal,
// so a view's region holds the whole mask its cut left: what the journal restores, flag for flag.
// The regions saved to and restored from are the camera block's words, as the kernels read them.
import type { PackedDag } from '../../../packages/sdk-browser/src/gpu/dag/selection.ts'
import { DAG_BINDING } from '../../../packages/sdk-browser/src/gpu/dag/shader/bindings.ts'
import { REGION_NONE } from '../../../packages/sdk-browser/src/gpu/dag/shader/swapWgsl.ts'
import { viewWord } from '../../../packages/sdk-browser/src/gpu/dag/viewLayout.ts'
import {
  DIFFERENCE_KERNELS,
  mirrorDifferenceStage,
} from '../../../packages/sdk-browser/src/gpu/dag/difference.fixture.ts'
import { words } from './mockBuffers.ts'

/** Every kernel this file mirrors. */
export const LIST_KERNELS: readonly string[] = [
  ...DIFFERENCE_KERNELS,
  'dagClearDrawn',
  'dagRestoreJournal',
]

/** Each region's mask, by the flags buffer it was saved from. */
const regions = new WeakMap<Uint8Array, Uint32Array[]>()

/** The mirror of `stage` on the bound buffers, true when it is one of `LIST_KERNELS`. */
export function mirrorListStage(
  stage: string,
  byBinding: ReadonlyMap<number, { data: Uint8Array }>,
  dag: Pick<PackedDag, 'nodeCount' | 'pageCount'>,
  listCap: number,
) {
  if (mirrorDifferenceStage(stage, words(byBinding.get(DAG_BINDING.out)!.data), listCap))
    return true
  if (stage !== 'dagClearDrawn' && stage !== 'dagRestoreJournal') return false
  const views = words(byBinding.get(DAG_BINDING.views)!.data),
    save = views[viewWord('swapRegions')] & 0xffff,
    restore = views[viewWord('swapRegions')] >>> 16
  const flags = byBinding.get(DAG_BINDING.flags)!.data,
    mask = words(flags).subarray(dag.nodeCount, dag.nodeCount + dag.pageCount)
  const held = regions.get(flags) ?? []
  regions.set(flags, held)
  if (stage === 'dagClearDrawn' && save !== REGION_NONE) held[save] = mask.slice()
  if (stage === 'dagRestoreJournal' && held[restore]) mask.set(held[restore])
  return true
}
