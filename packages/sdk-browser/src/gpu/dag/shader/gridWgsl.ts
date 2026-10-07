import { DISPATCH_SPAN } from '../../raster/contract.ts'
import { ceilDiv } from '../../../../../math/src/scalar/integers.ts'

/**
 * DISPATCHES IN ROWS: a cut's pass counts one thread per page, node, slot or listed entry, and a
 * scene of many can ask more workgroups than one dimension of a dispatch holds
 * (`maxComputeWorkgroupsPerDimension`, 65,535 by default) — past it, the dispatch is invalid or
 * skipped, and the cut is gone. So every pass runs in rows: `width` workgroups along x, as many
 * rows along y as it takes. One row while it fits: the dispatch of before, to the command.
 *
 * Each kernel reads its flat index off both (`flatIndex`), and a thread past the count leaves on
 * the guard it already had. A flat dispatch's rows come from the host (`dispatchGrid`); an
 * indirect one's from its list's appends, which raise the argument's x and y words as each slice
 * of sixty-four opens (`openSlice`), so `work` carries both words and one arming lane copies them
 * (`armWgsl.ts`).
 */
export const DEFAULT_GROUP_WIDTH = DISPATCH_SPAN

/** The `[x, y]` workgroups of a dispatch of `groups`, in rows of at most `width`. */
export function dispatchGrid(groups: number, width = DEFAULT_GROUP_WIDTH): [number, number] {
  return groups <= width ? [groups, 1] : [width, ceilDiv(groups, width)]
}

/** The width a device's dispatches run in: its own limit, WebGPU's default without one. */
export const groupWidth = (limits?: { maxComputeWorkgroupsPerDimension?: number }) =>
  limits?.maxComputeWorkgroupsPerDimension ?? DEFAULT_GROUP_WIDTH

/** A thread's flat index in a dispatch in rows (\`dispatchGrid\`), alone: what a kernel that opens
 *  no slice of a list reads, without the \`work\` words \`openSlice\` raises. */
export const FLAT_INDEX_WGSL = `/** The rank of thread \`(x, y)\` among the dispatch's, row after row of \`width\` groups of 64. */
fn flatIndex(x:u32,y:u32,width:u32)->u32{return x+y*width*64u;}
`

/** A workgroup's flat rank in a dispatch in rows (\`dispatchGrid\`): what a kernel that works a
 *  group at a time, or whose groups are not of 64 lanes, reads — its lanes after it. */
export const FLAT_GROUP_WGSL = `/** The rank of workgroup \`(x, y)\` among the dispatch's, row after row of \`width\`. */
fn flatGroup(x:u32,y:u32,width:u32)->u32{return x+y*width;}
`

export const DAG_GRID_WGSL = `/** Workgroups along x of a dispatch in rows: the device's limit, set at pipeline creation when it
 *  is not WebGPU's default (\`../pipeline.ts\`). */
override GROUP_WIDTH:u32=${DEFAULT_GROUP_WIDTH}u;
${FLAT_INDEX_WGSL}/** The argument's x once slice \`slice\` is open: its groups, at most one row. */
fn gridX(slice:u32)->u32{return min(slice+1u,GROUP_WIDTH);}
/** The argument's y once slice \`slice\` is open: the rows its groups take. */
fn gridY(slice:u32)->u32{return slice/GROUP_WIDTH+1u;}
/** Slice \`slice\` of a list opened: the dispatch argument at \`groups\` — x, then y — covers it. */
fn openSlice(groups:u32,slice:u32){atomicMax(&work[groups],gridX(slice));atomicMax(&work[groups+1u],gridY(slice));}
`
