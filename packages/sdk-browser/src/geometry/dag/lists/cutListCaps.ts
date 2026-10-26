import {
  CUT_RULES,
  type CutField,
  type CutOptions,
} from '../../../../../sdk-core/src/contracts/cutOptions.ts'
import { readSetting } from '../../../../../sdk-core/src/contracts/settingRules.ts'
import { clamp } from '../../../../../math/src/scalar/reals.ts'
import { storageBufferCap } from '../../../session/memory/pools.ts'
import { PAGE_INFO_STRIDE } from '../../../visibility/types.ts'

/**
 * THE CAPS OF THE CUT'S LISTS, read from their settings (`cutMaxNodes`, `cutMaxCandidateClusters`,
 * `cutMaxVisibleClusters`, `../../../../../sdk-core/src/contracts/cutOptions.ts`): what the cut's
 * flags are laid out for (`../flagSections.ts`) and what its kernels hold each list to
 * (`../shader/levelWgsl.ts`). The frame reads them at each image and hands them to the cut, which
 * makes its lists again between two frames when they change (`../queueGrowth.ts`).
 */

/** The nodes the reference's node batch holds — a workgroup of 64 threads, four a node — and the
 *  clusters its cluster batch holds: what its node and candidate caps are rounded down to. */
const NODE_BATCH = 16,
  CLUSTER_BATCH = 64

/** What the cut's lists hold at most: the nodes one pass opens, the candidate clusters and the
 *  clusters drawn, both passes' — each pass's peak read against them (`listFeedback.ts`). */
export type CutListCaps = { nodes: number; candidates: number; visible: number }

/** The setting that raises each list's cap, and the batch the cap rounds down to — 1 for none: the
 *  one table of the lists' settings (`cutListCaps`, the overflows `listFeedback.ts` says). */
export const LIST_SETTINGS = {
  nodes: { field: 'cutMaxNodes', batch: NODE_BATCH },
  candidates: { field: 'cutMaxCandidateClusters', batch: CLUSTER_BATCH },
  visible: { field: 'cutMaxVisibleClusters', batch: 1 },
} as const satisfies Record<keyof CutListCaps, { field: CutField; batch: number }>

/** The caps `options` name, each read by its one resolver — its default when absent —, the nodes
 *  and the candidates rounded down to their batch as the reference rounds them: a setting at most
 *  2³¹ − 1 keeps the bitwise rounding exact. */
export function cutListCaps(options: CutOptions = {}): CutListCaps {
  const cap = (list: keyof CutListCaps) =>
    readSetting(CUT_RULES, options, LIST_SETTINGS[list].field) & -LIST_SETTINGS[list].batch
  return { nodes: cap('nodes'), candidates: cap('candidates'), visible: cap('visible') }
}

/** `caps` held to what one storage binding of the device holds: the clusters drawn are a record each
 *  in the decoded clusters, the widest table the list's room sizes (`PAGE_INFO_STRIDE` bytes
 *  a record, the list's own rows and the bins' instances being narrower). The one place the device
 *  bounds the list, so that its growth, its readback warnings and its refusals all speak of the
 *  same number. */
export const limitedCaps = (
  caps: CutListCaps,
  limits: Parameters<typeof storageBufferCap>[0],
): CutListCaps => ({
  ...caps,
  visible: clamp(Math.floor(storageBufferCap(limits) / PAGE_INFO_STRIDE), 1, caps.visible),
})

/** Whether two sets of caps are the same. */
export const sameListCaps = (a: CutListCaps, b: CutListCaps) =>
  a.nodes === b.nodes && a.candidates === b.candidates && a.visible === b.visible
