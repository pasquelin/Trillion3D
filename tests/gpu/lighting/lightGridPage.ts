/**
 * The light grid on the GPU: the engine's grid pass (`createGpuLightTiles`) on a
 * real device, over lights the proof draws, each cell's list read back as the resolve walks it
 * (`cellSlice`): its lights, or `null` where the pool had no room (every light of the scene), and
 * its count's shadow bit; and the walk of every light a pixel with no list makes (`TILE_NO_SLICE`), the ranks it takes.
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
import { directLightWgsl } from '../../../packages/sdk-browser/src/lighting/direct/lightWgsl.ts'
import { TILE_SLICE_WGSL } from '../../../packages/sdk-browser/src/lighting/direct/lightingWgsl.ts'
import { wgslProgram } from '../../../packages/math/src/wgsl/assemble.ts'
import { openGpuDevice } from '../../kit/device/webgpuDevice.ts'

export type GridLamp = { position: [number, number, number]; range: number; slot: boolean }
const SHADOWED = 0x80000000
/** The walk of every light of a pixel with no list (`cellSlice` of `TILE_NO_SLICE`), the ranks it takes in `walked`, after their count. */
const WALK_EVERY_LIGHT = wgslProgram(
  `@group(0) @binding(0) var<storage,read> directLights:DirectLights;
@group(0) @binding(1) var<storage,read> tileLights:array<u32>;
@group(0) @binding(2) var<storage,read_write> walked:array<u32>;
@compute @workgroup_size(1)
fn walk(){
 let slice=cellSlice(TILE_NO_SLICE);
 var taken=0u;
 for(var index=0u;index<slice.y;index++){
  let rank=listedLight(slice,index);
  if(!listedDrawn(slice,rank)){continue;}
  walked[1u+taken]=rank;
  taken++;
 }
 walked[0]=taken;
}`,
  [directLightWgsl(), TILE_SLICE_WGSL],
)

/** The ranks the walk of every light takes over the lights in `lights`. */
async function everyLightWalked(
  device: GPUDevice,
  lights: GPUBuffer,
  tileLists: GPUBuffer,
  count: number,
) {
  const module = device.createShaderModule({ code: WALK_EVERY_LIGHT })
  const pipeline = device.createComputePipeline({
    layout: 'auto',
    compute: { module, entryPoint: 'walk' },
  })
  const walked = device.createBuffer({
    size: (1 + count) * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  })
  const group = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [lights, tileLists, walked].map((buffer, binding) => ({
      binding,
      resource: { buffer },
    })),
  })
  const encoder = device.createCommandEncoder()
  const pass = encoder.beginComputePass()
  pass.setPipeline(pipeline)
  pass.setBindGroup(0, group)
  pass.dispatchWorkgroups(1)
  pass.end()
  device.queue.submit([encoder.finish()])
  const words = (await readGpuBuffer(device, walked, walked.size))!
  walked.destroy()
  return [...words.subarray(1, 1 + words[0])]
}
/** The proof's grid cuts nothing — no depth pyramid, every number of the cull at 0 — and slices by
 *  the oracle's map (`GRID_MAP`). */
const NO_CULL: LightGridCull = {
  depth: undefined,
  words: new Float32Array(7),
  map: new Float32Array([...GRID_MAP, 0]),
}

/** The grid pass over each set of lamps, seen from `view` (`tileCamera.fixture.ts`). */
export async function run({
  view,
  sets,
  drawn,
}: {
  view: ReturnType<typeof camera>
  sets: GridLamp[][]
  /** Per set and lamp, whether the view draws it (`lightDrawn`, `lighting/lightDrawRange.ts`): the bit of its kind word that says it does not is set
   *  where it is false. */
  drawn: boolean[][]
}) {
  const opened = await openGpuDevice()
  if (!opened) return { unavailable: 'no WebGPU adapter' } as const
  const { device } = opened
  const { width, height } = view
  const tiles = await createGpuLightTiles(device)
  const runs = []
  for (const [s, set] of sets.entries()) {
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
    set.forEach((_, k) => store.assignDrawn(k, drawn[s][k]))
    const lights = createWebgpuLightState(store)
    lights.buffer = createSceneLightContractBuffer(device, store)
    uploadSceneLights(device, lights)
    tiles.ensure(width, height, lights.buffer, 32, true) // the settings' defaults
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
    const walked = await everyLightWalked(device, lights.buffer, tiles.buffer!, set.length)
    lights.buffer.destroy()
    runs.push({ columnsX: tiles.tilesX, cells, walked })
  }
  tiles.dispose()
  return { adapter: (await opened.fermer()).court, errors: opened.errors, runs }
}
