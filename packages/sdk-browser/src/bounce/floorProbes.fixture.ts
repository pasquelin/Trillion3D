// The probes the bounce tests drive: the engine's own, on the kit's device, over a scene of one
// placement that wears a proxy above the floor they keep.
import { fakeDevice } from '../../../../tests/kit/gpu/fakeDevice.ts'
import { createGpuLightTiles } from '../lighting/tiles/tiles.ts'
import { createGpuBounceProbes } from './probes.ts'
import { createProxyBudget } from '../../../sdk-core/src/proxy/budget.ts'

/** The probes over the floor `[0, 0, 0]–[8, 0.1, 4]`, the light list they read, the tiles when
 *  `tiled` (the world grid's lists), and an encoder of the device. */
export async function floorProbes(tiled = false) {
  const gpu = fakeDevice({
    limits: { maxStorageBufferBindingSize: 1 << 30, maxBufferSize: 1 << 30 },
  })
  const lights = gpu.device.createBuffer({ size: 64, usage: GPUBufferUsage.STORAGE })
  const tiles = tiled ? await createGpuLightTiles(gpu.device) : undefined
  // One placement wears a proxy: its buffer and instances, the worlds it is placed by and the tree
  // its rays walk, and its box over the floor the probes keep.
  const texel = (format: GPUTextureFormat) =>
    gpu.device
      .createTexture({ size: [1, 1, 1], format, usage: GPUTextureUsage.TEXTURE_BINDING })
      .createView({ dimension: '2d-array' })
  const worlds = texel('rgba32uint'),
    tree = texel('r32uint'),
    instances = texel('rgba32uint')
  const scene = {
    proxy: () => ({ buffer: lights, instances, worlds, tree }),
    boxes: () => ({
      boxes: Float64Array.from([0, 0, 0, 8, 0.1, 4]),
      moved: { count: 0, pairs: new Int32Array(0) },
      extent: [0, 0, 0, 8, 0.1, 4],
    }),
  }
  const probes = await createGpuBounceProbes(
    gpu.device,
    [0, 0, 0, 8, 0.1, 4],
    scene,
    () => lights,
    createProxyBudget(1000),
    tiles && (() => tiles),
  )
  return { gpu, lights, tiles, probes, encoder: gpu.device.createCommandEncoder() }
}
