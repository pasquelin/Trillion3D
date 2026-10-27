import { ceilDiv } from '../../../math/src/scalar/integers.ts'
import { autoKernel } from '../gpu/core/computeStages.ts'
import { bufferEntries } from '../gpu/core/computeBindings.ts'
import { uniformBlock, type UniformBlock } from '../gpu/core/uniformBlock.ts'
import { wordViews } from '../gpu/core/wordViews.ts'
import { writeChanged } from '../gpu/core/writeChanged.ts'
import { dispatchRows, WORKGROUP_THREADS } from '../gpu/dispatch/grid.ts'
import { GROUP_BOUNDS_WGSL, MACRO_BOUNDS_WGSL } from './boundsWgsl.ts'
import { MAX_MACRO_GROUPS } from './macroGroups.ts'
import { HAIR_STRANDS_PASS_PREFIX } from '../diagnostic/stage/passLabels.ts'

/** The smallest voxel a macro group is given, in metres: a hundredth of a centimetre. */
export const HAIR_MIN_VOXEL_SIZE = 0.0001
/** The words of the camera's block: the camera's orientation (16), the size in world units of a
 *  pixel at a distance of 1 (the pixel's size for an orthographic view), the pixels a voxel spans, the
 *  voxels a page spans a side, the smallest voxel, and whether the projection is a perspective one. */
const HAIR_CAMERA_WORDS = 24
/** The words of a macro group's entry: its rank, the rank of its first instance in the list of
 *  registered instances, the instances it lists, and one unused. */
export const HAIR_ENTRY_WORDS = 4
/** The floats of an instance's bounds: its low corner and its high corner, each a vector of four. */
export const HAIR_BOUNDS_FLOATS = 8

const groupBoundsKernel = autoKernel(
  `${HAIR_STRANDS_PASS_PREFIX}group bounds`,
  GROUP_BOUNDS_WGSL,
  'hairGroupBounds',
)
const macroBoundsKernel = autoKernel(
  `${HAIR_STRANDS_PASS_PREFIX}macro group bounds`,
  MACRO_BOUNDS_WGSL,
  'hairMacroBounds',
)

/** What the CPU writes each image, in place: the words of each block, the count of the entries and of
 *  the registered instances they list, and the camera's block. */
export interface HairBoundsUpdate {
  /** The instances' boxes in the camera's translated world, `HAIR_BOUNDS_FLOATS` floats each. */
  readonly bounds: ReturnType<typeof wordViews>
  /** The ranks of the instances each macro group lists. */
  readonly registered: ReturnType<typeof wordViews>
  /** The macro groups' entries, `HAIR_ENTRY_WORDS` words each. */
  readonly entries: ReturnType<typeof wordViews>
  readonly camera: UniformBlock
  entryCount: number
  registeredCount: number
}

/**
 * The buffers of the bounds passes for a scene of `instanceCount` instances: what the CPU writes
 * each image (the instances' bounds, the macro groups' entries, the instances each lists, the
 * camera's block) and what the passes write (the instances' bounds as integers, the macro groups'
 * bounds as integers and their voxel sizes). The last two are read back by the proofs.
 */
export interface HairBoundsGpu {
  readonly bounds: GPUBuffer
  readonly groupAabb: GPUBuffer
  readonly entries: GPUBuffer
  readonly registered: GPUBuffer
  readonly macroAabb: GPUBuffer
  readonly macroVoxelSize: GPUBuffer
  readonly instanceCount: number
  readonly update: HairBoundsUpdate
  /** The bytes the buffers hold. */
  readonly bytes: number
  /** The bind groups, made once the programs compile. */
  groupBind?: GPUBindGroup
  macroBind?: GPUBindGroup
  destroy(): void
}

/** Creates the buffers of the bounds passes for `instanceCount` instances; `readable`, the bounds and
 *  voxel sizes they write can be read back (a proof's). */
export function createHairBounds(
  device: GPUDevice,
  instanceCount: number,
  readable: boolean,
): HairBoundsGpu {
  const make = (label: string, size: number, usage: GPUBufferUsageFlags) =>
    device.createBuffer({ label: `${HAIR_STRANDS_PASS_PREFIX}${label}`, size, usage })
  const input = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
  const output = GPUBufferUsage.STORAGE | (readable ? GPUBufferUsage.COPY_SRC : 0)
  const camera = uniformBlock(device, `${HAIR_STRANDS_PASS_PREFIX}camera`, HAIR_CAMERA_WORDS * 4)
  const buffers = {
    bounds: make('instance bounds', instanceCount * HAIR_BOUNDS_FLOATS * 4, input),
    groupAabb: make('instance integer bounds', instanceCount * 6 * 4, output),
    entries: make('macro group entries', MAX_MACRO_GROUPS * HAIR_ENTRY_WORDS * 4, input),
    registered: make('registered instances', instanceCount * 4, input),
    macroAabb: make('macro group bounds', MAX_MACRO_GROUPS * 6 * 4, output),
    macroVoxelSize: make('macro group voxel sizes', MAX_MACRO_GROUPS * 4, output),
  }
  const words = (count: number) => wordViews(new ArrayBuffer(count * 4))
  return {
    ...buffers,
    instanceCount,
    update: {
      bounds: words(instanceCount * HAIR_BOUNDS_FLOATS),
      registered: words(instanceCount),
      entries: words(MAX_MACRO_GROUPS * HAIR_ENTRY_WORDS),
      camera,
      entryCount: 0,
      registeredCount: 0,
    },
    bytes:
      Object.values(buffers).reduce((sum, buffer) => sum + buffer.size, 0) + HAIR_CAMERA_WORDS * 4,
    destroy() {
      for (const buffer of Object.values(buffers)) buffer.destroy()
      camera.buffer.destroy()
    },
  }
}

/**
 * Writes the words of `gpu.update` that changed and encodes the two bounds passes in `pass`: the
 * instances' bounds, then the macro groups' (one workgroup each), which read them. Nothing while a
 * program compiles; returns whether the passes were encoded (they are not when no macro group lists
 * an instance).
 */
export function encodeHairBounds(
  device: GPUDevice,
  pass: GPUComputePassEncoder,
  gpu: HairBoundsGpu,
) {
  const { update } = gpu
  if (update.entryCount === 0) return true
  const group = groupBoundsKernel(device).get(),
    macro = macroBoundsKernel(device).get()
  if (!group || !macro) return false
  gpu.groupBind ??= device.createBindGroup({
    layout: group.getBindGroupLayout(0),
    entries: bufferEntries([gpu.bounds, gpu.groupAabb]),
  })
  gpu.macroBind ??= device.createBindGroup({
    layout: macro.getBindGroupLayout(0),
    entries: bufferEntries([
      update.camera.buffer,
      gpu.entries,
      gpu.registered,
      gpu.groupAabb,
      gpu.macroAabb,
      gpu.macroVoxelSize,
    ]),
  })
  writeChanged(device, gpu.bounds, update.bounds.u, 0, gpu.instanceCount * HAIR_BOUNDS_FLOATS)
  writeChanged(device, gpu.entries, update.entries.u, 0, update.entryCount * HAIR_ENTRY_WORDS)
  writeChanged(device, gpu.registered, update.registered.u, 0, update.registeredCount)
  update.camera.send()
  pass.setPipeline(group)
  pass.setBindGroup(0, gpu.groupBind)
  dispatchRows(pass, ceilDiv(gpu.instanceCount, WORKGROUP_THREADS))
  pass.setPipeline(macro)
  pass.setBindGroup(0, gpu.macroBind)
  pass.dispatchWorkgroups(update.entryCount)
  return true
}
