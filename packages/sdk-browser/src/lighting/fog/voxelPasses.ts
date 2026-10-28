import { namedEntries } from '../../gpu/core/computeBindings.ts'
import { WORKGROUP_THREADS } from '../../gpu/dispatch/grid.ts'
import {
  heldProgramGroup,
  keptProgramGroup,
  type ProgramGroups,
} from '../../gpu/bind/programGroups.ts'
import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import type { FogGrid } from './layout.ts'
import { FOG_BINDING, type FogProgramName } from './bindings.ts'
import type { LazyProgram } from './resources.ts'
import type { VoxelBuffers } from './voxelGpu.ts'
import type { FogAtlas } from './voxelGraph.ts'

/** What the voxelisation's passes are made over (a part of `FogPassContext`): the device, the
 *  layout and pipeline of each program, the groups, the voxelisation's buffers, how many objects
 *  it holds this image and the cells the view uses. */
/** The voxelisation of the graphs of this image's objects, where it is made: its program, the groups
 *  it keeps, the buffer of the graphs' values and, where a graph reads a texture, the colour atlas. */
export interface VoxelGraphPass {
  program: {
    layout: GPUBindGroupLayout
    pipeline: { get(): GPUComputePipeline | undefined; ready: boolean }
  }
  groups: ProgramGroups
  values: GPUBuffer
  atlas?: FogAtlas
}

export interface VoxelPassContext {
  device: GPUDevice
  resources: {
    frame: { buffer: GPUBuffer }
    programs: Record<
      Exclude<FogProgramName, LazyProgram>,
      { layout: GPUBindGroupLayout; pipeline: { get(): GPUComputePipeline | undefined } }
    >
  }
  groups: { prepare: ProgramGroups; voxelize: ProgramGroups; voxelizeGraph: ProgramGroups }
  voxel: VoxelBuffers
  voxelObjects: number
  cells: FogGrid
  /** The voxelisation of the objects' graphs, none where they wear none or its program is not made. */
  graph?: VoxelGraphPass
}

/** The two volumes the objects are voxelised into: their scattering with the extinction, and their
 *  emissive light. */
export type VoxelTextures = readonly [GPUTextureView, GPUTextureView]

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
function voxelizeEntries(
  { resources, voxel }: VoxelPassContext,
  voxels: VoxelTextures,
  graph?: VoxelGraphPass,
) {
  return namedEntries(FOG_BINDING, {
    frame: { buffer: resources.frame.buffer },
    voxelFrame: { buffer: voxel.frame },
    voxelObjects: { buffer: voxel.objects },
    voxelSpansRead: { buffer: voxel.spans },
    voxelOut: voxels[0],
    voxelEmitOut: voxels[1],
    ...(graph && {
      graphValues: { buffer: graph.values },
      ...(graph.atlas && {
        graphPool0: graph.atlas.views[0],
        graphPool1: graph.atlas.views[1],
        graphPool2: graph.atlas.views[2],
        graphPages: { buffer: graph.atlas.pages },
        graphSampler: graph.atlas.sampler,
      }),
    }),
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
  // Neither pass without the other: the second reads what the first wrote.
  const prepare = programs.prepare.pipeline.get()
  if (!prepare) return
  const first = groups.prepare.identity.next
  first[0] = voxel.frame
  first[1] = voxel.objects
  first[2] = voxel.spans
  pass.setPipeline(prepare)
  pass.setBindGroup(
    0,
    heldProgramGroup(groups.prepare) ??
      keptProgramGroup(device, programs.prepare.layout, groups.prepare, prepareEntries(context)),
  )
  pass.dispatchWorkgroups(ceilDiv(context.voxelObjects, WORKGROUP_THREADS))
  // The program that evaluates the graphs of the objects, once it is compiled: the plain one serves
  // until then, the objects with a graph adding what their material gives.
  const graph = context.graph?.program.pipeline.ready ? context.graph : undefined
  const program = graph?.program ?? programs.voxelize
  const pipeline = program.pipeline.get()
  if (!pipeline) return
  const held = graph?.groups ?? groups.voxelize
  const second = held.identity.next
  second[0] = voxel.frame
  second[1] = voxel.objects
  second[2] = voxel.spans
  second[3] = voxels[0]
  second[4] = voxels[1]
  second[5] = graph?.values
  second[6] = graph?.atlas?.views[0]
  second[7] = graph?.atlas?.views[1]
  second[8] = graph?.atlas?.views[2]
  second[9] = graph?.atlas?.pages
  second[10] = graph?.atlas?.sampler
  pass.setPipeline(pipeline)
  pass.setBindGroup(
    0,
    heldProgramGroup(held) ??
      keptProgramGroup(device, program.layout, held, voxelizeEntries(context, voxels, graph)),
  )
  pass.dispatchWorkgroups(ceilDiv(cells.x, 4), ceilDiv(cells.y, 4), ceilDiv(cells.z, 4))
}
