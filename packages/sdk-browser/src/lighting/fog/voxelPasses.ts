import { namedEntries } from '../../gpu/core/computeBindings.ts'
import { heldGroup, keptGroup, threads, type ProgramGroups } from './groupKeeping.ts'
import type { FogGrid } from './layout.ts'
import { FOG_BINDING, type FogProgramName } from './bindings.ts'
import type { VoxelBuffers } from './voxelGpu.ts'

/** What the voxelisation's passes are made over (a part of `FogPassContext`): the device, the
 *  layout and pipeline of each program, the groups, the voxelisation's buffers, how many objects
 *  it holds this image and the cells the view uses. */
export interface VoxelPassContext {
  device: GPUDevice
  resources: {
    frame: { buffer: GPUBuffer }
    programs: Record<
      Exclude<FogProgramName, 'scatterSky'>,
      { layout: GPUBindGroupLayout; pipeline: { get(): GPUComputePipeline } }
    >
  }
  groups: { prepare: ProgramGroups; voxelize: ProgramGroups }
  voxel: VoxelBuffers
  voxelObjects: number
  cells: FogGrid
}

/** The two volumes the objects are voxelised into: their scattering with the extinction, and their
 *  emissive light. */
export type VoxelTextures = readonly [
  { readonly view: GPUTextureView },
  { readonly view: GPUTextureView },
]

/** The entries of the first pass's group: the frame, the voxelisation's frame, the objects and the
 *  spans written. */
function prepareEntries({ resources, voxel }: VoxelPassContext) {
  return namedEntries(FOG_BINDING, {
    frame: { buffer: resources.frame.buffer },
    voxelFrame: { buffer: voxel.frame },
    voxelObjects: { buffer: voxel.objects },
    voxelSpans: { buffer: voxel.spans },
  })
}

/** The entries of the second pass's group: the same, the spans read, and the two volumes written. */
function voxelizeEntries({ resources, voxel }: VoxelPassContext, voxels: VoxelTextures) {
  return namedEntries(FOG_BINDING, {
    frame: { buffer: resources.frame.buffer },
    voxelFrame: { buffer: voxel.frame },
    voxelObjects: { buffer: voxel.objects },
    voxelSpansRead: { buffer: voxel.spans },
    voxelOut: voxels[0].view,
    voxelEmitOut: voxels[1].view,
  })
}

/**
 * The slices each voxelised object reaches, one thread an object (`prepareMain`), then the medium
 * each cell holds of them (`voxelizeMain`), into the two volumes `voxels` the scatter reads. The
 * second reads what the first wrote: the dispatches of one compute pass are ordered.
 */
export function encodeVoxels(
  pass: GPUComputePassEncoder,
  context: VoxelPassContext,
  voxels: VoxelTextures,
) {
  const { device, resources, groups, voxel, cells } = context
  const { programs } = resources
  const first = groups.prepare.identity.next
  first[0] = voxel.frame
  first[1] = voxel.objects
  first[2] = voxel.spans
  pass.setPipeline(programs.prepare.pipeline.get())
  pass.setBindGroup(
    0,
    heldGroup(groups.prepare) ??
      keptGroup(device, programs.prepare.layout, groups.prepare, prepareEntries(context)),
  )
  pass.dispatchWorkgroups(threads(context.voxelObjects, 64))
  const second = groups.voxelize.identity.next
  second[0] = voxel.frame
  second[1] = voxel.objects
  second[2] = voxel.spans
  second[3] = voxels[0]
  second[4] = voxels[1]
  pass.setPipeline(programs.voxelize.pipeline.get())
  pass.setBindGroup(
    0,
    heldGroup(groups.voxelize) ??
      keptGroup(
        device,
        programs.voxelize.layout,
        groups.voxelize,
        voxelizeEntries(context, voxels),
      ),
  )
  pass.dispatchWorkgroups(threads(cells.x, 4), threads(cells.y, 4), threads(cells.z, 4))
}
