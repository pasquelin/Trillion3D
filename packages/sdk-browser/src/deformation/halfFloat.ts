import { halfCeilBits } from '../../../math/src/float/half.ts'
import { wgslConst, wgslFn } from '../../../math/src/wgsl/decl.ts'
import { wgslF32 } from '../../../math/src/wgsl/number.ts'
import { REACH_UNBOUNDED } from '../geometry/dag/placement/placementTree.ts'
import type { WebgpuPagesRuntime } from '../frame/backend/runtime.ts'
import type { ClusterRoot, PageRec } from '../geometry/selection/types.ts'

/** THE MARK WORD A ROOT SENDS THE GPU CUT (`markWorld`): its `mark` with its deformation `reach`
 *  in the high sixteen bits — the smallest half float at or above it (`halfCeilBits`): a reach the
 *  GPU cut reads never below the one the CPU cut grows by —, as the cut reads it (`reachOf`). Every
 *  sender builds it here: a word without the reach would shrink a deformed root's bounds on the
 *  GPU. */
export const rootMark = ({ mark = 0, reach = 0 }: { mark?: number; reach?: number }) =>
  ((mark & 0xffff) | (halfCeilBits(reach) << 16)) >>> 0

/** THE ONE WRITER OF A ROOT'S REACH (`ClusterRoot.reach`), the sum of what its deformation moves a
 *  vertex (`deformReach`, `holdReach`) and what its surfaces' offsets may (`offsetReach`,
 *  `holdOffsetReach`): root `rank` reaches that far from where its pages are bounded, which the CPU
 *  cut reads there and the GPU cut in its mark word (`rootMark`), sent again only when it changes.
 *  Returns whether it changed. */
function sendReach(rt: WebgpuPagesRuntime, rank: number, root: ClusterRoot<PageRec>) {
  const total = (root.deformReach ?? 0) + (root.offsetReach ?? 0)
  if (total === (root.reach ?? 0)) return false
  root.reach = total
  rt.run.gpuSelection?.markWorld(rank, rootMark(root))
  return true
}

/** Root `rank`'s deformation moves a vertex up to `reach` this frame (`sendReach`). */
export function holdReach(rt: WebgpuPagesRuntime, rank: number, reach: number) {
  const root = rt.layout.selectionRoots[rank]
  root.deformReach = reach
  return sendReach(rt, rank, root)
}

/** Root `rank`'s offsets move a vertex up to `reach` (`sendReach`), in its units. */
export function holdOffsetReach(rt: WebgpuPagesRuntime, rank: number, reach: number) {
  const root = rt.layout.selectionRoots[rank]
  root.offsetReach = reach
  return sendReach(rt, rank, root)
}

/** The reach a mark word carries (`rootMark`), read in WGSL: infinite past every finite one. */
export const markReachWgsl = wgslFn(
  'markReach',
  [],
  'fn markReach(mark:u32)->f32{return unpack2x16float(mark).y;}',
)

/** A box that bounds nothing finite reaches every page: as large an extent as f32 clip math
 *  keeps. */
export const UNBOUNDED_EXTENT = 1e15

/** `UNBOUNDED_EXTENT` as a WGSL constant of the same name. */
export const UNBOUNDED_EXTENT_WGSL = wgslConst(
  'UNBOUNDED_EXTENT',
  [],
  `const UNBOUNDED_EXTENT:f32=${wgslF32(UNBOUNDED_EXTENT)};`,
)

/** A reach that bounds nothing (infinite, or not a number) as large as f32 clip math keeps
 *  (`UNBOUNDED_EXTENT`): the casters' and the descent's boxes of a placement are the same finite
 *  ones. */
export const casterReachWgsl = wgslFn(
  'casterReach',
  [UNBOUNDED_EXTENT_WGSL],
  'fn casterReach(reach:f32)->f32{return select(UNBOUNDED_EXTENT,reach,reach<UNBOUNDED_EXTENT);}',
)

/** Whether a mark word's reach is past every finite one (`REACH_UNBOUNDED`), read in WGSL. */
export const reachUnboundedWgsl = wgslFn(
  'reachUnbounded',
  [],
  `fn reachUnbounded(mark:u32)->bool{return (mark>>16u)>=${REACH_UNBOUNDED}u;}`,
)
