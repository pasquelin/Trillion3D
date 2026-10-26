import {
  COMPUTE,
  computeStorageTextureEntry,
  computeUniformEntry,
} from '../../../gpu/core/computeBindings.ts'
import { askedComputeStage } from '../../../gpu/core/computeStages.ts'
import { airLayoutEntries } from '../../../lighting/atmosphere/programs.ts'
import { DEFAULT_AIR_SHAPE, type AirShape } from '../../../lighting/atmosphere/shape.ts'
import {
  CLOUD_EMPTY_SPACE_BINDING as B,
  CLOUD_EMPTY_SPACE_ENTRY,
  CLOUD_EMPTY_SPACE_FORMAT,
  emptySpaceProgram,
} from './emptySpaceWgsl.ts'
import { cloudMaterialLayoutEntries } from './materialWgsl.ts'
import { CLOUD_EMPTY_SPACE_SIDE } from './traceOptions.ts'
import { CLOUD_TRACE_AIR } from './traceWgsl.ts'

/**
 * THE EMPTY-SPACE TABLE, DECLARED AND ENCODED: its two bind group layouts, its pipeline, its
 * texture and its dispatch. Group 0 is the air's, as the view tracing's; group 1 holds the
 * material's seven bindings, the trace's block (`writeCloudTrace`, the very block the tracing
 * reads) and the table, written (`CLOUD_EMPTY_SPACE_FORMAT`, `CLOUD_EMPTY_SPACE_SIDE` texels across
 * and down). The pass runs for a frame that asked for the table (`cloudTraceKey`), never in a
 * reflection, before the tracing (`viewFrame.ts`); the tracing reads the table it wrote.
 */
function cloudEmptySpaceLayoutEntries(): GPUBindGroupLayoutEntry[] {
  return [
    ...cloudMaterialLayoutEntries(B.material),
    computeUniformEntry(B.block),
    computeStorageTextureEntry(B.table, CLOUD_EMPTY_SPACE_FORMAT),
  ]
}

/** The groups to dispatch: one to a texel of the table. */
export const CLOUD_EMPTY_SPACE_DISPATCH = {
  x: CLOUD_EMPTY_SPACE_SIDE,
  y: CLOUD_EMPTY_SPACE_SIDE,
  z: 1,
} as const

/** The pass's layouts and its pipeline, asked now, off the frame, with the corners option (the
 *  froxel's corners are read as well as its centre), the air's programs written for `shape`;
 *  `failed` hears a failure to compile. */
export function createCloudEmptySpacePass(
  device: GPUDevice,
  failed: (error: unknown) => void,
  corners: boolean,
  shape: AirShape = DEFAULT_AIR_SHAPE,
) {
  const air = device.createBindGroupLayout({
    entries: airLayoutEntries(CLOUD_TRACE_AIR, COMPUTE, shape),
  })
  const cloud = device.createBindGroupLayout({ entries: cloudEmptySpaceLayoutEntries() })
  const pipeline = askedComputeStage(
    device,
    [air, cloud],
    emptySpaceProgram(corners, shape).code,
    CLOUD_EMPTY_SPACE_ENTRY,
    'Trillion3D cloud empty space',
    failed,
  )
  return { air, cloud, pipeline }
}

/** `GPUTextureUsage`'s flags, written in the clear. */
const TEXTURE_BINDING = 4,
  STORAGE_BINDING = 8

/** Bytes of a texel of the table: one 32-bit float. */
const TABLE_TEXEL_BYTES = 4

/** The place for a view's empty-space table: made on the first ask, kept until released. */
export function emptySpaceTableSlot(device: GPUDevice) {
  let held: { texture: GPUTexture; view: GPUTextureView } | undefined
  return {
    /** The table's view, the texture made on the first ask. */
    get view() {
      if (!held) {
        const texture = device.createTexture({
          label: 'Trillion3D cloud empty space table',
          size: { width: CLOUD_EMPTY_SPACE_SIDE, height: CLOUD_EMPTY_SPACE_SIDE },
          format: CLOUD_EMPTY_SPACE_FORMAT,
          usage: STORAGE_BINDING | TEXTURE_BINDING,
        })
        held = { texture, view: texture.createView() }
      }
      return held.view
    },
    get bytes() {
      return held ? CLOUD_EMPTY_SPACE_SIDE * CLOUD_EMPTY_SPACE_SIDE * TABLE_TEXEL_BYTES : 0
    },
    release() {
      held?.texture.destroy()
      held = undefined
    },
  }
}
