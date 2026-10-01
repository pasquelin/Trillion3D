/**
 * Page side of the light grid probe (#1369): the engine's grid pass (`createGpuLightTiles`) on a
 * real device, over lights the Node side draws, each cell's list read back as the resolve walks it
 * (`cellSlice`): its lights, or `null` where the pool had no room (every light of the scene), and
 * its count's shadow bit.
 */
import { createSceneLightStore, LIGHT_SETTINGS } from '../../../packages/sdk-core/src/index.ts';
import { createGpuLightTiles } from '../../../packages/sdk-browser/src/lighting/tiles/tiles.ts';
import {
  createSceneLightContractBuffer,
  uploadSceneLights,
} from '../../../packages/sdk-browser/src/webgpu/pages/state/lightBuffer.ts';
import { readGpuBuffer } from '../../../packages/sdk-browser/src/gpu/core/readback.ts';
import { camera } from '../../../packages/sdk-browser/src/lighting/tiles/tileCamera.fixture.ts';
import { TILE_STRIDE_WORDS } from '../../../packages/sdk-browser/src/lighting/direct/lightWgsl.ts';
import { openGpuDevice } from './webgpuDevice.ts';

/** The probe's view: cut cells on both axes. */
export const GRID_VIEW = {
  eye: [3, 40, -5],
  yaw: 0.8,
  pitch: -0.6,
  fov: 70,
  width: 333,
  height: 207,
} as const;
export type GridLamp = { position: [number, number, number]; range: number; slot: boolean };
const SHADOWED = 0x80000000;

export async function run(sets: GridLamp[][]) {
  const opened = await openGpuDevice();
  if (!opened) return { unavailable: 'no WebGPU adapter' } as const;
  const { device } = opened;
  const { eye, yaw, pitch, fov, width, height } = GRID_VIEW;
  const view = camera([...eye], yaw, pitch, fov, width, height);
  const tiles = await createGpuLightTiles(device);
  const runs = [];
  for (const set of sets) {
    const store = createSceneLightStore();
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
    );
    set.forEach(({ slot }, k) => slot && store.assignSlice(k, 0));
    const lights = {
      store,
      buffer: createSceneLightContractBuffer(device, store),
      uploadedEpoch: -1,
    };
    uploadSceneLights(device, lights as Parameters<typeof uploadSceneLights>[1]);
    tiles.ensure(width, height, lights.buffer);
    tiles.update(view.viewProjection, view.eye, width, height);
    const encoder = device.createCommandEncoder();
    tiles.encode(encoder, 1);
    device.queue.submit([encoder.finish()]);
    const words = (await readGpuBuffer(device, tiles.buffer!, tiles.buffer!.size))!;
    const cells = [];
    for (let cell = 0; cell < tiles.tilesX * tiles.tilesY * LIGHT_SETTINGS.gridSlices; cell++) {
      const [count, first] = [words[cell * TILE_STRIDE_WORDS], words[cell * TILE_STRIDE_WORDS + 1]];
      const kept = count & ~SHADOWED;
      cells.push({
        shadowed: (count & SHADOWED) !== 0,
        list: first === 0xffffffff ? null : [...words.subarray(first, first + kept)],
      });
    }
    lights.buffer.destroy();
    runs.push({ columnsX: tiles.tilesX, cells });
  }
  tiles.dispose();
  return { adapter: (await opened.fermer()).court, errors: opened.erreurs, runs };
}
