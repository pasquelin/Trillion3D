import { computeBufferEntry } from '../../gpu/core/computeBindings.ts'
import { oncePerDevice } from '../../gpu/core/oncePerDevice.ts'
import type { FrameContext } from './liveShadingContext.ts'
import { HV_GRID_SAMPLE_BINDING } from './gridSampleWgsl.ts'
import { volumeBinds } from './liveShadingVolume.ts'
import { storageBuffersOf, volumeResourcesOf } from './liveShadingResources.ts'
import type { Program, placementOf } from './liveShadingState.ts'
import { NO_LOD, worldBoundsOf } from './volumeLod.ts'
import type { GridSource } from './voxelGrid/gridRasterize.ts'

type Placed = ReturnType<typeof placementOf>

/** The layout of the second group of the pass that samples a volume's material at the voxels of a grid: the buffer of samples. */
export const gridSampleLayoutOf = oncePerDevice((device: GPUDevice) =>
  device.createBindGroupLayout({
    label: 'Trillion3D heterogeneous volume grid samples',
    entries: [computeBufferEntry(HV_GRID_SAMPLE_BINDING.binding, 'storage')],
  }),
)

const asked = new WeakSet<Program>()

/** The pass that samples the volume's material, asked off the frame the first time and kept with the program; none until it is compiled. */
function samplePipelineOf(c: FrameContext, program: Program) {
  const { device, rt } = c
  if (!program.raster && program.module && !asked.has(program)) {
    asked.add(program)
    device
      .createComputePipelineAsync({
        label: 'Trillion3D heterogeneous volume grid sample',
        layout: device.createPipelineLayout({
          bindGroupLayouts: [program.layout, gridSampleLayoutOf(device)],
        }),
        compute: { module: program.module, entryPoint: 'hvGridSampleMain' },
      })
      .then(
        (pipeline) => {
          program.raster = pipeline
          rt.run.gate.resourcesChanged()
        },
        (error: unknown) => rt.diag.diagnosticFailure('heterogeneous-volume-program-failed', error),
      )
  }
  return program.raster
}

/** The smallest voxel a volume asks: its bounds over its resolution along the axis where the voxel is smallest, in the world; 0.001 at least. */
function minimumVoxelSizeOf(item: Placed) {
  const m = item.toWorld
  const sizes = [0, 1, 2].map(
    (axis) =>
      (2 * item.extent[axis] * Math.hypot(m[4 * axis], m[4 * axis + 1], m[4 * axis + 2])) /
      Math.max(item.entry.resolution[axis], 1),
  )
  return Math.max(Math.min(...sizes), 0.001)
}

/**
 * The volumes of the image as the voxel grids take them (`GridSource`): the volume's bounds in the world and how to evaluate its material at the voxels of a
 * grid, by the program of the volume. None where a volume's program, or the pass that samples it, is not compiled yet: the grids are built the next image.
 */
export function gridSourcesOf(c: FrameContext): GridSource[] | undefined {
  const sources: GridSource[] = []
  for (const item of c.placed) {
    const resources = volumeResourcesOf({
      held: c.held,
      rt: c.rt,
      device: c.device,
      sparse: c.sparse,
      placed: item,
      settings: c.settings,
      beerFormat: c.beerFormat,
      lod: NO_LOD,
      holdout: false,
      variant: 'plain',
    })
    if (!resources) return undefined
    // The pass that samples binds one more storage buffer than the others.
    if (
      storageBuffersOf(resources.program.compiled.uses.textures, 'plain') + 1 >
      c.device.limits.maxStorageBuffersPerShaderStage
    )
      return undefined
    const pipeline = samplePipelineOf(c, resources.program)
    if (!pipeline) return undefined
    const group = volumeBinds(c, item, resources, false, NO_LOD).filling(
      'grid samples',
      undefined,
      {},
    )
    const world = worldBoundsOf(item.toWorld, item.centre, item.extent)
    sources.push({
      volume: { ...world, minimumVoxelSize: minimumVoxelSizeOf(item) },
      boxMin: world.origin.map((o, i) => o - world.extent[i]) as unknown as [
        number,
        number,
        number,
      ],
      boxMax: world.origin.map((o, i) => o + world.extent[i]) as unknown as [
        number,
        number,
        number,
      ],
      sample: (encoder, samples, args) => {
        const pass = encoder.beginComputePass({
          label: 'Trillion3D heterogeneous volume grid sample',
        })
        pass.setPipeline(pipeline)
        pass.setBindGroup(0, group)
        pass.setBindGroup(
          1,
          c.device.createBindGroup({
            layout: gridSampleLayoutOf(c.device),
            entries: [{ binding: HV_GRID_SAMPLE_BINDING.binding, resource: { buffer: samples } }],
          }),
        )
        pass.dispatchWorkgroupsIndirect(args, 0)
        pass.end()
      },
    })
  }
  return sources
}
