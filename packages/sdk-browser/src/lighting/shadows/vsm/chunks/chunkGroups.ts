/**
 * THE GROUPS AND COMMANDS OF A CHUNKED RASTER (`chunkKernels.ts`): the groups over the scene's rows
 * and the lists, made again when one of them moved, then the candidates and each chunk's cull —
 * the opaque raster's and the transmission's.
 */
import { ceilDiv } from '../../../../../../math/src/scalar/integers.ts'
import { dispatchRows, WORKGROUP_THREADS } from '../../../../gpu/dispatch/grid.ts'
import type { HeldGroup, WebgpuBindIdentity } from '../../../../gpu/bind/bindIdentity.ts'
import { sequentialEntries } from '../../../../gpu/core/computeBindings.ts'
import { oncePerDevice } from '../../../../gpu/core/oncePerDevice.ts'
import { standInTexture } from '../../../../gpu/core/standInTexture.ts'
import { arrayView } from '../../../../gpu/core/textureViews.ts'
import { COLD_TABLE } from '../../../../geometry/dag/cut/cutTables.ts'
import { vsmBufferGroup } from '../passKit.ts'
import { VSM_RENDER_ARGS_CULL, VSM_RENDER_ARGS_STRIDE_WORDS } from '../render/renderParamsWgsl.ts'
import { VSM_RENDER_WORLD_GROUP } from '../render/renderCandidatesWgsl.ts'
import type { VsmChunkKernels } from './chunkKernels.ts'
import type { VsmListName } from './chunkSizing.ts'
import { VSM_RENDER_PARAMS_BYTES } from './chunkParams.ts'
import type { VsmRenderScene } from '../render/renderPass.ts'

/** The dynamic offset of the parameters' first slot, held: the candidates and the cull's arguments
 *  bind it every frame without a new array. */
const FIRST_SLOT: readonly number[] = [0]

/** The candidates kernel over `rowCount` rows — its group 0 `candGroup`, the camera cut's world
 *  switch `worldGroup` (`vsmWorldGroup`) — and the views with pages to draw among the first
 *  `mapCount` maps (`../render/renderViewsWgsl.ts`, groups `views0` over the VSM tables, `views1` over the
 *  lists), then the cull dispatch of every chunk, in `pass`: the opaque raster's and the
 *  transmission's. */
export function encodeVsmCandidates(
  pass: GPUComputePassEncoder,
  candidates: GPUComputePipeline,
  candGroup: GPUBindGroup,
  worldGroup: GPUBindGroup,
  kernels: VsmChunkKernels,
  groups: { args: GPUBindGroup; views0: GPUBindGroup; views1: GPUBindGroup },
  rowCount: number,
  mapCount: number,
) {
  pass.setPipeline(candidates)
  pass.setBindGroup(0, candGroup, FIRST_SLOT)
  pass.setBindGroup(VSM_RENDER_WORLD_GROUP, worldGroup)
  dispatchRows(pass, ceilDiv(rowCount, WORKGROUP_THREADS))
  pass.setPipeline(kernels.views.pipeline)
  pass.setBindGroup(0, groups.views0)
  pass.setBindGroup(1, groups.views1, FIRST_SLOT)
  dispatchRows(pass, ceilDiv(mapCount, WORKGROUP_THREADS))
  const argsGroup = groups.args
  pass.setPipeline(kernels.args.cull.pipeline)
  pass.setBindGroup(0, argsGroup, FIRST_SLOT)
  pass.dispatchWorkgroups(1)
}

/** What the candidates read of the camera cut's world switch while it follows none: a stand-in for
 *  its cold words and its frame words — two `r32uint` tables — which the gate then never reads
 *  (`worldGateWgsl`), one a device. */
const noWorld = oncePerDevice((device: GPUDevice) =>
  arrayView(standInTexture(device, 'Trillion3D shadow casters no world', COLD_TABLE.format)),
)

/** The candidates' group over the camera cut's world switch (`VsmRenderScene.world`), held in
 *  `held` on `layout` (`VSM_RENDER_WORLD_GROUP`): made again only when the layout or the cut's
 *  tables moved — another cut, or a world packed or let go. */
export function vsmWorldGroup(
  device: GPUDevice,
  held: HeldGroup,
  layout: GPUBindGroupLayout,
  world: VsmRenderScene['world'],
) {
  const { next } = held.identity,
    cold = world?.cold ?? noWorld(device),
    frames = world?.frames ?? cold
  next[0] = layout
  next[1] = cold
  next[2] = frames
  next.length = 3
  if (held.identity.moved())
    held.group = device.createBindGroup({ layout, entries: sequentialEntries([cold, frames]) })
  return held.group!
}

/** The bind groups of one chunk's views and cull: `views0` / `cull0` the VSM tables', the others
 *  at the chunk's dynamic offset. */
export interface VsmChunkGroups {
  views0: GPUBindGroup
  views1: GPUBindGroup
  cull0: GPUBindGroup
  cull1: GPUBindGroup
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
  next[11] = b.order
  next[12] = own
  next.length = own ? 13 : 12
  return identity.moved()
}

/** The groups of a chunk pass over the scene's rows and the lists `b`: the candidates' — `extra`
 *  after its counts —, the views', the cull's and the arguments'; with the parameters' window and
 *  the lists the pass's own groups bind. */
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
    views1: group(kernels.views.groups[1], [params, views, counts]),
    cull1: group(kernels.cull.groups[1], [params, views, candidates, counts, cmds]),
    args: group(kernels.args.cull.groups[0], [params, counts, args]),
  }
}
