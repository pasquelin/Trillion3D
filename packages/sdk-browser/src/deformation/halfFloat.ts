import { fromHalf, toHalf } from '../../../math/src/float/half.ts'
import { HALF_MAX } from '../../../math/src/constants.ts'
import { wgslFn } from '../../../math/src/wgsl/decl.ts'
import { REACH_UNBOUNDED } from '../gpu/dag/placementTree.ts'
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts'

/** A half float's value from its sixteen bits, positive ones: what `unpack2x16float` reads. */
const halfValue = (bits: number) => (bits >= REACH_UNBOUNDED ? Infinity : fromHalf(bits))

/** The smallest half float at or above `x`, as its sixteen bits: a reach the GPU cut reads never
 *  below the one the CPU cut grows by; past the largest finite half, infinity. */
function halfAtLeast(x: number) {
  if (!(x > 0)) return 0
  if (x > HALF_MAX) return REACH_UNBOUNDED
  // The nearest half is one of the two around `x`: the one below steps up to the one above.
  let bits = toHalf(x)
  while (halfValue(bits) < x) bits++
  return bits
}

/** THE MARK WORD A ROOT SENDS THE GPU CUT (`markWorld`): its `mark` with its deformation `reach`
 *  in the high sixteen bits, as the cut reads it (`reachOf`). Every sender builds it here: a word
 *  without the reach would shrink a deformed root's bounds on the GPU. */
export const rootMark = ({ mark = 0, reach = 0 }: { mark?: number; reach?: number }) =>
  ((mark & 0xffff) | (halfAtLeast(reach) << 16)) >>> 0

/** THE ONE WRITER OF A ROOT'S REACH (`ClusterRoot.reach`): root `rank` reaches `reach` from where
 *  its pages are bounded, which the CPU cut reads there and the GPU cut in its mark word
 *  (`rootMark`), sent again only when it changes. Returns whether it changed. */
export function holdReach(rt: WebgpuPagesRuntime, rank: number, reach: number) {
  const root = rt.layout.selectionRoots[rank]
  if (reach === (root.reach ?? 0)) return false
  root.reach = reach
  rt.run.gpuSelection?.markWorld(rank, rootMark(root))
  return true
}

/** The reach a mark word carries (`rootMark`), read in WGSL: infinite past every finite one. */
export const markReachWgsl = wgslFn(
  'markReach',
  [],
  'fn markReach(mark:u32)->f32{return unpack2x16float(mark).y;}',
)

/** Whether a mark word's reach is past every finite one (`REACH_UNBOUNDED`), read in WGSL. */
export const reachUnboundedWgsl = wgslFn(
  'reachUnbounded',
  [],
  `fn reachUnbounded(mark:u32)->bool{return (mark>>16u)>=${REACH_UNBOUNDED}u;}`,
)
