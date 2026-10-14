/**
 * THE GROUPS AND COMMANDS OF A CHUNKED RASTER (`chunkKernels.ts`): the groups over the scene's rows
 * and the lists, made again when one of them moved, then the candidates and each chunk's cull —
 * the opaque raster's and the transmission's.
 */
import { ceilDiv } from '../../../math/src/scalar/integers.ts'
import { dispatchRows, WORKGROUP_THREADS } from '../gpu/dispatch/grid.ts'
import type { WebgpuBindIdentity } from '../webgpu/core/bindIdentity.ts'
import { vsmBufferGroup } from './passKit.ts'
import { VSM_RENDER_ARGS_CULL, VSM_RENDER_ARGS_STRIDE_WORDS } from './renderParamsWgsl.ts'
import type { VsmChunkKernels } from './chunkKernels.ts'
import type { VsmListName } from './chunkSizing.ts'
import { VSM_RENDER_PARAMS_BYTES } from './chunkParams.ts'
import type { VsmRenderScene } from './renderPass.ts'

/** The dynamic offset of the parameters' first slot, held: the candidates and the cull's arguments
 *  bind it every frame without a new array. */
const FIRST_SLOT: readonly number[] = [0]

/** The candidates kernel over `rowCount` rows, then the cull dispatch of every chunk, in `pass`:
 *  the opaque raster's and the transmission's. */
export function encodeVsmCandidates(
  pass: GPUComputePassEncoder,
  candidates: GPUComputePipeline,
  candGroup: GPUBindGroup,
  kernels: VsmChunkKernels,
  argsGroup: GPUBindGroup,
  rowCount: number,
) {
  pass.setPipeline(candidates)
  pass.setBindGroup(0, candGroup, FIRST_SLOT)
  dispatchRows(pass, ceilDiv(rowCount, WORKGROUP_THREADS))
  pass.setPipeline(kernels.args.cull.pipeline)
  pass.setBindGroup(0, argsGroup, FIRST_SLOT)
  pass.dispatchWorkgroups(1)
}

/** The bind groups of one chunk's cull and expand: `cull0` / `expand0` the VSM tables', the
 *  others at the chunk's dynamic offset. */
export interface VsmChunkGroups {
  cull0: GPUBindGroup
  cull1: GPUBindGroup
  expand0: GPUBindGroup
  expand1: GPUBindGroup
  args: GPUBindGroup
}

/** Chunk `c`'s cull, then the expand's indirect arguments (one group per command), in `pass`: what
 *  the raster expands into pairs and the transmission bins. The cull reads its arguments from
 *  `args`, no group for a chunk with no candidate; the argument kernel runs one thread, directly:
 *  it writes `args`, bound as storage, and a dispatch may not read its arguments from a buffer it
 *  binds writable (one usage scope). */
export function encodeVsmChunkCommands(
  pass: GPUComputePassEncoder,
  kernels: VsmChunkKernels,
  groups: Pick<VsmChunkGroups, 'cull0' | 'cull1' | 'args'>,
  args: GPUBuffer,
  c: number,
  offset: readonly number[],
) {
  pass.setPipeline(kernels.cull.pipeline)
  pass.setBindGroup(0, groups.cull0)
  pass.setBindGroup(1, groups.cull1, offset)
  pass.dispatchWorkgroupsIndirect(
    args,
    c * VSM_RENDER_ARGS_STRIDE_WORDS * 4 + VSM_RENDER_ARGS_CULL * 4,
  )
  pass.setPipeline(kernels.args.expand.pipeline)
  pass.setBindGroup(0, groups.args, offset)
  pass.dispatchWorkgroups(1)
}

/**
 * Whether what a chunk pass's groups bind moved since they were made: the scene's rows, the lists
 * `b`, and the `own` object whose buffers the pass's own groups bind, none changing while it lives
 * (the transmission's). `identity` compares them alone, and holds them after.
 */
export function vsmSceneRowsMoved(
  identity: WebgpuBindIdentity,
  scene: VsmRenderScene,
  b: Record<VsmListName, GPUBuffer>,
  own?: object,
) {
  const next = identity.next
  next[0] = scene.pageTable
  next[1] = scene.spheres
  next[2] = scene.mobility
  next[3] = scene.rowLods
  next[4] = b.params
  next[5] = b.views
  next[6] = b.candidates
  next[7] = b.counts
  next[8] = b.cmds
  next[9] = b.pairs
  next[10] = b.args
  next[11] = own
  next.length = own ? 12 : 11
  return identity.moved()
}

/** The groups of a chunk pass over the scene's rows and the lists `b`: the candidates' — `extra`
 *  after its counts —, the cull's, the expand's and the arguments'; with the parameters' window
 *  and the lists the pass's own groups bind. */
export function vsmChunkListGroups(
  device: GPUDevice,
  kernels: VsmChunkKernels,
  candidatesLayout: GPUBindGroupLayout,
  scene: VsmRenderScene,
  b: Record<VsmListName, GPUBuffer>,
  extra: readonly GPUBuffer[] = [],
) {
  const { views, candidates, counts, cmds, pairs, args } = b
  const params = { buffer: b.params, size: VSM_RENDER_PARAMS_BYTES }
  const group = (layout: GPUBindGroupLayout, buffers: (GPUBuffer | typeof params)[]) =>
    vsmBufferGroup(device, layout, buffers)
  const { pageTable, spheres, mobility, rowLods } = scene
  return {
    params,
    counts,
    pairs,
    cand: group(candidatesLayout, [
      params,
      pageTable,
      spheres,
      mobility,
      rowLods,
      candidates,
      counts,
      ...extra,
    ]),
    cull1: group(kernels.cull.groups[1], [params, views, candidates, counts, cmds]),
    expand1: group(kernels.expand.groups[1], [params, cmds, counts, pairs]),
    args: group(kernels.args.cull.groups[0], [params, counts, args]),
  }
}
