// The probes the bounce tests drive: the engine's own, on the kit's device, over a scene of one
// placement that wears a proxy above the floor they keep.
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { createGpuLightTiles } from '../tiles/tiles.ts'
import { createGpuBounceProbes } from './probes/probes.ts'
import { NO_PROXY_BOXES } from './probes/probeSync.ts'
import { BOUNCE_PROBE_QUEUE } from '../../../../sdk-core/src/bounce/contracts.ts'

/** The eye the floor is read from: the tests encode with it. */
export const FLOOR_EYE = [4, 4, 2]

/** The cells an image of the floor reads: the eight probes around a point of it every metre, a
 *  step of the normal bias above it, in the two finest levels — marked as the image's marks would be,
 *  once the levels follow the eye. */
function readFloor(probes: Awaited<ReturnType<typeof createGpuBounceProbes>>) {
  const { cascades, pool } = probes
  cascades.follow(FLOOR_EYE)
  for (let level = 0; level < 2; level++) {
    const spacing = cascades.levels[level].spacing
    for (let x = 0.5; x < 8; x++)
      for (let z = 0.5; z < 4; z++)
        for (let corner = 0; corner < 8; corner++) {
          const at = [x, 0.35 * spacing, z].map(
            (v, axis) => Math.floor(v / spacing - 0.5) + ((corner >> axis) & 1),
          )
          pool.mark(level, at[0], at[1], at[2], 1)
        }
  }
}

/** The probes over the floor `[0, 0, 0]–[8, 0.1, 4]`, the light list they read, the tiles when
 *  `tiled` (the world grid's lists), and an encoder of the device. The cells of the floor are read
 *  (`readFloor`) unless `read` is false: the series has work, as it has once an image marked what it
 *  shows. */
export async function floorProbes(tiled = false, read = true) {
  const gpu = fakeDevice({
    limits: { maxStorageBufferBindingSize: 1 << 30, maxBufferSize: 1 << 30 },
  })
  const lights = gpu.device.createBuffer({ size: 64, usage: GPUBufferUsage.STORAGE })
  const tiles = tiled ? await createGpuLightTiles(gpu.device) : undefined
  // One placement wears a proxy: its buffer, the worlds it is placed by — its instance their
  // `Instance` field — and the tree its rays walk, and its box over the floor the probes keep.
  const texel = (format: GPUTextureFormat) =>
    gpu.device
      .createTexture({ size: [1, 1, 1], format, usage: GPUTextureUsage.TEXTURE_BINDING })
      .createView({ dimension: '2d-array' })
  const worlds = texel('rgba32uint'),
    tree = texel('r32uint')
  const scene = {
    proxy: () => ({ buffer: lights, worlds, tree }),
    boxes: () => ({
      ...NO_PROXY_BOXES,
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
    // The deferred placeholders' empty lists, as the engine passes them.
    gpu.device.createBuffer({ size: 256, usage: GPUBufferUsage.STORAGE }),
    tiles && (() => tiles),
  )
  if (read) readFloor(probes)
  return { gpu, lights, tiles, probes, encoder: gpu.device.createCommandEncoder() }
}
