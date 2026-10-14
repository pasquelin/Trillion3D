/**
 * THE GROUPS AND COMMANDS OF A CHUNKED RASTER (`chunkKernels.ts`): the groups over the scene's rows
 * and the lists, made again when one of them moved, then the candidates and each chunk's cull —
 * the opaque raster's and the transmission's.
 */
import { ceilDiv } from '../../../math/src/scalar/integers.ts'
import { dispatchRows, WORKGROUP_THREADS } from '../gpu/dispatch/grid.ts'
import type { WebgpuBindIdentity } from '../webgpu/core/bindIdentity.ts'
import { vsmBufferGroup } from './passKit.ts'
import { VSM_RENDER_ARGS_CULL, VSM_RENDER_ARGS_STRIDE_WORDS } from './renderCullWgsl.ts'
import type { VsmChunkKernels } from './chunkKernels.ts'
import type { VsmListName } from './chunkLists.ts'
import { VSM_RENDER_PARAMS_BYTES } from './chunkParams.ts'
import type { VsmRenderScene } from './renderPass.ts'

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
  pass.setBindGroup(0, candGroup, [0])
  dispatchRows(pass, ceilDiv(rowCount, WORKGROUP_THREADS))
  pass.setPipeline(kernels.args.cull.pipeline)
  pass.setBindGroup(0, argsGroup, [0])
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
 * Whether what a chunk pass's groups bind moved since they were made — the scene's rows and the
 * lists (the first 11 words of `identity`, the raster's and the transmission's draw's), then the
 * `extra` words of its own the pass wrote after them —: `identity` holds them after.
 */
export function vsmSceneRowsMoved(
  identity: WebgpuBindIdentity,
  scene: VsmRenderScene,
  b: Record<VsmListName, GPUBuffer>,
  extra = 0,
) {
  const bound = identity.next
  bound[0] = scene.pageTable
  bound[1] = scene.spheres
  bound[2] = scene.mobility
  bound[3] = scene.rowLods
  bound[4] = b.params
  bound[5] = b.views
  bound[6] = b.candidates
  bound[7] = b.counts
  bound[8] = b.cmds
  bound[9] = b.pairs
  bound[10] = b.args
  bound.length = 11 + extra
  return identity.moved()
}

/** The groups of a chunk pass over the scene's rows and the lists `bound` names
 *  (`vsmSceneRowsMoved`): the candidates' — `extra` after its counts —, the cull's, the expand's
 *  and the arguments'; with the parameters' window and the lists the pass's own groups bind. */
export function vsmChunkListGroups(
  device: GPUDevice,
  kernels: VsmChunkKernels,
  candidatesLayout: GPUBindGroupLayout,
  bound: readonly unknown[],
  extra: readonly GPUBuffer[] = [],
) {
  const [
    pageTable,
    spheres,
    mobility,
    rowLods,
    paramsBuffer,
    views,
    candidates,
    counts,
    cmds,
    pairs,
    args,
  ] = bound as GPUBuffer[]
  const params = { buffer: paramsBuffer, size: VSM_RENDER_PARAMS_BYTES }
  const group = (layout: GPUBindGroupLayout, buffers: (GPUBuffer | typeof params)[]) =>
    vsmBufferGroup(device, layout, buffers)
  return {
    params,
    counts,
    pairs,
    cand: group(candidatesLayout, [
      ...[params, pageTable, spheres, mobility],
      ...[rowLods, candidates, counts, ...extra],
    ]),
    cull1: group(kernels.cull.groups[1], [params, views, candidates, counts, cmds]),
    expand1: group(kernels.expand.groups[1], [params, cmds, counts, pairs]),
    args: group(kernels.args.cull.groups[0], [params, counts, args]),
  }
}
