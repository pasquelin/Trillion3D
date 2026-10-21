import { CLUSTER_NEVER } from '../clusterFlags.ts'
import {
  bandError,
  bandSphere,
  boxInto,
  type DagRecords,
  flagsOf,
  ownerOf,
  worldOf,
} from '../records.fixture.ts'
import { frustumExcludesBox } from '../../../../../math/src/geometry/frustum/box.ts'
import { dagScratch, projectedError } from './math.fixture.ts'
import { drawsCluster } from '../../cut/rule.fixture.ts'
import type { DescentFlags } from './descent.fixture.ts'
import { NO_INDEX } from '../../../../../math/src/constants.ts'

/** The cut rule as the oracle applies it on page `page`: `drawsCluster`'s operands, then the page. */
export type CutRuleAt = (
  resident: boolean,
  parentPixels: number,
  ownPixels: number,
  childResident: boolean,
  threshold: number,
  page: number,
) => boolean

type PredicateContext = {
  /** Unique decoder, opened once per evaluation and shared with the rest of the oracle. */
  records: DagRecords
  /** Each (placement, node) verdict of the descent (`descent.fixture.ts`). */
  nodeFlags: Pick<DescentFlags, 'at'>
  planes: Float64Array[]
  views: number[][]
  stretches: number[]
  focal: number
  near: number
  perspective: number
  /** The cut rule applied: `drawsCluster`, or the kernel's WGSL call site run in Node by the
   *  rule's tests, which reads the page's residency itself. */
  rule?: CutRuleAt
}

export function createDagOraclePredicates(context: PredicateContext) {
  const { records, nodeFlags, planes, views, stretches, focal, near, perspective } = context
  const visible = (index: number) => {
    // The owner node lives in the cold, outside what each frame pass rereads.
    const node = ownerOf(records, index),
      w = worldOf(records, index)
    if (flagsOf(records, index) & CLUSTER_NEVER) return false
    if (node !== NO_INDEX && nodeFlags.at(w, node)) return false
    const { min, max } = dagScratch
    boxInto(records, index, min, max)
    return !frustumExcludesBox(planes[w], min[0], min[1], min[2], max[0], max[1], max[2])
  }
  const bandPixels = (index: number, at: number) => {
    const w = worldOf(records, index),
      sphere = bandSphere(records, index, at),
      { hot } = records
    return projectedError(
      bandError(records, index, at),
      hot[sphere],
      hot[sphere + 1],
      hot[sphere + 2],
      hot[sphere + 3],
      views[w],
      stretches[w],
      focal,
      near,
      perspective,
    )
  }
  /** The cut rule (`../../cut/rule.ts`) on page `index`, under the residency given. */
  const rule = context.rule ?? drawsCluster
  const draws = (index: number, threshold: number, ready: boolean, childReady: boolean) =>
    rule(ready, bandPixels(index, 1), bandPixels(index, 0), childReady, threshold, index)
  return { visible, draws }
}
