import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { ceilDiv as ceilDivWgsl } from '../../../../math/src/wgsl/integer.ts'

/**
 * DISPATCHES IN ROWS: a pass counts one thread per page, node, slot or listed entry, and a scene
 * of many can ask more workgroups than one dimension of a dispatch holds
 * (`maxComputeWorkgroupsPerDimension`) — past it, the dispatch is invalid or skipped, and its
 * work is gone. So every pass runs in rows: `width` workgroups along x, as many rows along y as it
 * takes. One row while it fits: the dispatch of before, to the command.
 *
 * Each kernel reads its flat rank off its builtins and `num_workgroups` (`flatIndex`), whatever
 * width the rows were cut at, and a thread past the count leaves on the guard it already had. A
 * flat dispatch's rows come from the host (`dispatchRows`, `dispatchGrid`); an indirect one's from
 * the kernel that writes its arguments, by the same split (`groupGrid`).
 */
export const DEFAULT_GROUP_WIDTH = 65535

/** The workgroups along x of a dispatch of `groups` in rows of at most `width`: one half of the
 *  split. */
const rowWidth = (groups: number, width = DEFAULT_GROUP_WIDTH) => Math.min(groups, width)

/** The rows of a dispatch of `groups` in rows of at most `width`: the split's other half. */
const rowsOf = (groups: number, width: number) => (groups <= width ? 1 : ceilDiv(groups, width))

/** The `[x, y]` workgroups of a dispatch of `groups`, in rows of at most `width`. */
export function dispatchGrid(groups: number, width = DEFAULT_GROUP_WIDTH): [number, number] {
  return [rowWidth(groups, width), rowsOf(groups, width)]
}

/** Dispatches `groups` workgroups on `pass`, `z` deep, in rows of at most `width`
 *  (`dispatchGrid`): the split goes straight to the pass, nothing allocated. */
export function dispatchRows(
  pass: Pick<GPUComputePassEncoder, 'dispatchWorkgroups'>,
  groups: number,
  z = 1,
  width = DEFAULT_GROUP_WIDTH,
) {
  pass.dispatchWorkgroups(rowWidth(groups, width), rowsOf(groups, width), z)
}

/** The width a device's dispatches run in: its own limit, WebGPU's guaranteed one without it. */
export const groupWidth = (limits?: { maxComputeWorkgroupsPerDimension?: number }) =>
  limits?.maxComputeWorkgroupsPerDimension ?? DEFAULT_GROUP_WIDTH

/** The flat rank in a dispatch in rows of one-dimensional workgroups of `lanes`: a thread's from
 *  `global_invocation_id`, or a workgroup's from `workgroup_id` with `lanes` of 1. */
export const FLAT_INDEX_WGSL = wgslBlock(
  'FLAT_INDEX_WGSL',
  [],
  `/** Rank of \`id\` among a dispatch of \`n\` workgroups of \`lanes\`, row after row. */
fn flatIndex(id:vec3u,n:vec3u,lanes:u32)->u32{return id.x+id.y*n.x*lanes;}
`,
)

/** The host's split (`dispatchGrid`) in WGSL, for a kernel that writes indirect arguments; the
 *  pipeline sets `GROUP_WIDTH` where the device's limit is not WebGPU's guaranteed one. */
export const GROUP_GRID_WGSL = wgslBlock(
  'GROUP_GRID_WGSL',
  [ceilDivWgsl],
  `override GROUP_WIDTH:u32=${DEFAULT_GROUP_WIDTH}u;
/** The \`(x, y)\` workgroups of a dispatch of \`groups\`, in rows of at most \`GROUP_WIDTH\`. */
fn groupGrid(groups:u32)->vec2u{return vec2u(min(groups,GROUP_WIDTH),ceilDiv(max(groups,1u),GROUP_WIDTH));}
`,
)

/** A list's indirect argument, x then y at `work[groups]`, raised by its appends as each slice of
 *  64 entries opens: the split only grows, so the last slice's stands. */
export const OPEN_SLICE_WGSL = wgslBlock(
  'OPEN_SLICE_WGSL',
  [GROUP_GRID_WGSL],
  `/** Slice \`slice\` of a list opened: the argument at \`groups\` covers it. */
fn openSlice(groups:u32,slice:u32){let g=groupGrid(slice+1u);atomicMax(&work[groups],g.x);atomicMax(&work[groups+1u],g.y);}
`,
)
