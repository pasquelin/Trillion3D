/**
 * The light grid on the GPU: the engine's grid pass (`createGpuLightTiles`) on a
 * real device, over lights the proof draws, each cell's list read back as the resolve walks it
 * (`cellSlice`): its lights, or `null` where the pool had no room (every light of the scene), and
 * its count's shadow bit.
 */
import { createSceneLightStore } from '../../../packages/sdk-core/src/scene/light/store.ts'
import { LIGHT_SETTINGS } from '../../../packages/sdk-core/src/scene/light/contracts.ts'
import { createGpuLightTiles } from '../../../packages/sdk-browser/src/lighting/tiles/tiles.ts'
import type { LightGridCull } from '../../../packages/sdk-browser/src/lighting/tiles/cullView.ts'
import {
  createSceneLightContractBuffer,
  uploadSceneLights,
} from '../../../packages/sdk-browser/src/frame/backend/state/lightBuffer.ts'
import { createWebgpuLightState } from '../../../packages/sdk-browser/src/frame/backend/state/lights.ts'
import { readGpuBuffer } from '../../../packages/sdk-browser/src/gpu/core/readback.ts'
import type { camera } from '../../../packages/sdk-browser/src/lighting/tiles/tileCamera.fixture.ts'
import {
  GRID_HEAD_WORDS,
  TILE_STRIDE_WORDS,
} from '../../../packages/sdk-browser/src/lighting/direct/lightWgsl.ts'
import { GRID_MAP } from '../../../packages/sdk-browser/src/lighting/tiles/tileCamera.fixture.ts'
import { openGpuDevice } from '../../kit/device/webgpuDevice.ts'

export type GridLamp = { position: [number, number, number]; range: number; slot: boolean }
const SHADOWED = 0x80000000
/** The proof's grid cuts nothing — no depth pyramid, every number of the cull at 0 — and slices by
 *  the oracle's map (`GRID_MAP`). */
const NO_CULL: LightGridCull = {
  depth: undefined,
  words: new Float32Array(8),
  map: new Float32Array([...GRID_MAP, 0]),
}

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
    tiles.ensure(width, height, lights.buffer, 32) // the setting's default
    tiles.update(view.viewProjection, view.eye, width, height, NO_CULL)
    const encoder = device.createCommandEncoder()
    tiles.encode(encoder, 1)
    device.queue.submit([encoder.finish()])
    const words = (await readGpuBuffer(device, tiles.buffer!, tiles.buffer!.size))!
    const cells = []
    for (let cell = 0; cell < tiles.tilesX * tiles.tilesY * LIGHT_SETTINGS.gridSlices; cell++) {
      const at = GRID_HEAD_WORDS + cell * TILE_STRIDE_WORDS
      const [count, first] = [words[at], words[at + 1]]
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
