import { createGpuPeriodicReadback } from '../../gpu/core/periodicReadback.ts'

/** Bytes of the counters: pixels counted, their steps, the most steps, one word of padding. */
const VOXEL_STEPS_BYTES = 16

/** The voxel trace's cost as the GPU last sampled it: the frame, the mean and the most DDA steps a
 *  counted pixel took (`VOXEL_STEPS_WGSL`). */
type VoxelStepsFrame = { frame: number; mean: number; max: number }

/**
 * The voxel trace's counters (`VOXEL_STEPS_WGSL`): the buffer the resolve binds, which frame counts
 * (`due`, one in fifteen, written into the resolve's uniform), the copy of that frame's counters
 * and their clear after it, so the next sampled frame starts from zero, and the last sample read.
 */
export function createVoxelSteps(device: GPUDevice) {
  const buffer = device.createBuffer({
    label: 'Trillion3D voxel steps',
    size: VOXEL_STEPS_BYTES,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
  })
  const read: VoxelStepsFrame = { frame: -1, mean: 0, max: 0 }
  let counting = false,
    sampledFrame = -1
  const reader = createGpuPeriodicReadback(
    device,
    { label: 'Trillion3D voxel steps readback', bytes: VOXEL_STEPS_BYTES },
    (mapped) => {
      const [pixels, steps, max] = new Uint32Array(mapped)
      read.frame = sampledFrame
      read.mean = pixels ? steps / pixels : 0
      read.max = max
    },
  )
  return {
    buffer,
    /** Whether frame `frame` counts: the resolve's uniform says it (`uni.voxelCounting`). */
    due(frame: number) {
      counting = reader.due(frame)
      return counting
    },
    /** The counting frame's copy, then the counters cleared for the next one. */
    encodeCopy(encoder: GPUCommandEncoder, frame: number) {
      if (!counting) return
      if (reader.copy(encoder, buffer, 0, VOXEL_STEPS_BYTES)) {
        reader.sampled(frame)
        sampledFrame = frame
      }
      encoder.clearBuffer(buffer)
    },
    submitted: reader.submitted,
    stats: () => (reader.ready ? read : undefined),
    dispose() {
      reader.dispose()
      buffer.destroy()
    },
  }
}
export type VoxelSteps = ReturnType<typeof createVoxelSteps>
