// The probes the bounce tests drive: the engine's own, on the kit's device, over a scene of one
// placement above the floor they keep.
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { createGpuBounceProbes } from './probes/probes.ts'
import { NO_PLACEMENT_BOXES } from '../../geometry/dag/placement/placementBoxes.ts'
import { BOUNCE_PROBE_QUEUE } from '../../../../sdk-core/src/bounce/contracts.ts'
import type { ScreenProbeSettings } from '../../../../sdk-core/src/bounce/screenProbeOptions.ts'

/** The eye the floor is read from: the tests encode with it. */
export const FLOOR_EYE = [4, 4, 2]
/** What the probes' maps read of the sky light over the recording device: stand-ins. */
export const FLOOR_SKY = { cube: {}, sampler: {}, harmonics: {}, params: {} } as never
/** What the probes' hits read — the global distance field their rays are marched through, and the surface cache — over the recording
 *  device: stand-ins. */
export const FLOOR_READS = {
  field: {
    readEntries: (first: number) =>
      Array.from({ length: 6 }, (_, at) => ({ binding: first + at, resource: {} })),
    readGeneration: 0,
  },
  hit: { tables: {}, depth: {}, final: {}, grid: {}, instances: {} },
} as never

/** The probes over the floor `[0, 0, 0]–[8, 0.1, 4]` and an encoder of the device. The series has work, as it has once the
 *  lights changed (`restart`), unless `read` is false: it has none till an image marks what it shows. The levels
 *  follow the eye the tests encode with. `settings` are the screen probes' the radiance cache follows (the defaults
 *  without). */
export async function floorProbes(read = true, settings?: () => ScreenProbeSettings) {
  const gpu = fakeDevice({
    limits: { maxStorageBufferBindingSize: 1 << 30, maxBufferSize: 1 << 30 },
  })
  const lights = gpu.device.createBuffer({ size: 64, usage: GPUBufferUsage.STORAGE })
  // One placement holds a box over the floor the probes keep.
  const scene = {
    boxes: () => ({
      ...NO_PLACEMENT_BOXES,
      boxes: Float64Array.from([0, 0, 0, 8, 0.1, 4]),
      extent: [0, 0, 0, 8, 0.1, 4],
    }),
  }
  const probes = await createGpuBounceProbes(
    gpu.device,
    [0, 0, 0, 8, 0.1, 4],
    scene,
    () => lights,
    BOUNCE_PROBE_QUEUE,
    settings,
  )
  probes.cascades.follow(FLOOR_EYE)
  if (read) probes.restart()
  return { gpu, lights, probes, encoder: gpu.device.createCommandEncoder() }
}
