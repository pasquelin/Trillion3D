/**
 * The light grid on the GPU: the engine's grid pass (`createGpuLightTiles`) on a
 * real device, over lights the proof draws, each cell's list read back as the resolve walks it
 * (`cellSlice`): its lights, or `null` where the pool had no room (every light of the scene), and
 * its count's shadow bit.
 */
import { createSceneLightStore, LIGHT_SETTINGS } from '../../../packages/sdk-core/src/index.ts'
import { createGpuLightTiles } from '../../../packages/sdk-browser/src/lighting/tiles/tiles.ts'
import {
  createSceneLightContractBuffer,
  uploadSceneLights,
} from '../../../packages/sdk-browser/src/webgpu/pages/state/lightBuffer.ts'
import { createWebgpuLightState } from '../../../packages/sdk-browser/src/webgpu/pages/state/lights.ts'
import { readGpuBuffer } from '../../../packages/sdk-browser/src/gpu/core/readback.ts'
import type { camera } from '../../../packages/sdk-browser/src/lighting/tiles/tileCamera.fixture.ts'
import { TILE_STRIDE_WORDS } from '../../../packages/sdk-browser/src/lighting/direct/lightWgsl.ts'
import { openGpuDevice } from '../kit/webgpuDevice.ts'

export type GridLamp = { position: [number, number, number]; range: number; slot: boolean }
const SHADOWED = 0x80000000

/** The grid pass over each set of lamps, seen from `view` (`tileCamera.fixture.ts`). */
export async function run({ view, sets }: { view: ReturnType<typeof camera>; sets: GridLamp[][] }) {
  const opened = await openGpuDevice()
  if (!opened) return { unavailable: 'no WebGPU adapter' } as const
  const { device } = opened
  const { width, height } = view
  const tiles = await createGpuLightTiles(device)
  const runs = []
  for (const set of sets) {
    const store = createSceneLightStore()
    set.forEach(({ position, range }, k) =>
      store.add({
        id: `l${k}`,
        kind: 'point',
        position,
        color: [1, 1, 1],
        intensity: 1,
        range,
        castsShadow: false,
      }),
    )
    set.forEach(({ slot }, k) => slot && store.assignSlice(k, 0))
    const lights = createWebgpuLightState(store)
    lights.buffer = createSceneLightContractBuffer(device, store)
    uploadSceneLights(device, lights)
    tiles.ensure(width, height, lights.buffer, store.count)
    tiles.update(view.viewProjection, view.eye, width, height)
    const encoder = device.createCommandEncoder()
    tiles.encode(encoder, 1)
    device.queue.submit([encoder.finish()])
    const words = (await readGpuBuffer(device, tiles.buffer!, tiles.buffer!.size))!
    const cells = []
    for (let cell = 0; cell < tiles.tilesX * tiles.tilesY * LIGHT_SETTINGS.gridSlices; cell++) {
      const [count, first] = [words[cell * TILE_STRIDE_WORDS], words[cell * TILE_STRIDE_WORDS + 1]]
      const kept = count & ~SHADOWED
      cells.push({
        shadowed: (count & SHADOWED) !== 0,
        list: first === 0xffffffff ? null : [...words.subarray(first, first + kept)],
      })
    }
    lights.buffer.destroy()
    runs.push({ columnsX: tiles.tilesX, cells })
  }
  tiles.dispose()
  return { adapter: (await opened.fermer()).court, errors: opened.errors, runs }
}
