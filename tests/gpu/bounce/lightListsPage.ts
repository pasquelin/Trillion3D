// Page of the bounce's world light lists proof (`light-lists.gpu.ts`): the light grid pass over a
// generated lattice (`createGpuLightTiles`, `world`), then the one irradiance the bounce cache and
// probe hits sum (`lightsIrradiance`), at generated points, walking each point's cell list and
// walking every light — both on the GPU, both read back, and each dispatch timed.
import { createSceneLightStore } from '../../../packages/sdk-core/src/index.ts'
import { lcgRandom } from '../../../packages/math/src/sequence/random.ts'
import { ceilDiv } from '../../../packages/math/src/scalar/integers.ts'
import { BASE, POINTS, SIDE, SPACING, lightsOf, pointsOf } from './lightListsScene.ts'
import { createGpuLightTiles } from '../../../packages/sdk-browser/src/lighting/tiles/tiles.ts'
import {
  createSceneLightContractBuffer,
  uploadSceneLights,
} from '../../../packages/sdk-browser/src/webgpu/pages/state/lightBuffer.ts'
import { createWebgpuLightState } from '../../../packages/sdk-browser/src/webgpu/pages/state/lights.ts'
import { DIRECT_LIGHT_WGSL } from '../../../packages/sdk-browser/src/lighting/direct/lightWgsl.ts'
import {
  LIGHTS_IRRADIANCE_WGSL,
  lightsIrradianceWgsl,
} from '../../../packages/sdk-browser/src/lighting/direct/lightLoopWgsl.ts'
import {
  BOUNCE_LIGHT_CELL_WGSL,
  BOUNCE_LIGHT_LIST_BINDING,
} from '../../../packages/sdk-browser/src/bounce/lightCellWgsl.ts'
import { BOUNCE_GRID_BYTES } from '../../../packages/sdk-browser/src/bounce/uniform.ts'
import { BOUNCE_SETTINGS } from '../../../packages/sdk-core/src/index.ts'
import { wgslProgram } from '../../../packages/math/src/wgsl/assemble.ts'
import { readBuffer } from '../kit/computeReadback.ts'
import { openGpuDevice } from '../kit/webgpuDevice.ts'

/** The irradiance kernel over `irradiance`: point i's sum into word 4i. */
const kernel = (listed: boolean) =>
  wgslProgram(
    `struct BounceLevel{originSpacing:vec4f,base:vec4f,}
struct BounceGrid{reach:vec4f,counts:vec4u,frame:vec4u,levels:array<BounceLevel,${BOUNCE_SETTINGS.cascadeLevels}>,}
@group(0) @binding(0) var<uniform> bounce:BounceGrid;
@group(0) @binding(1) var<storage,read> points:array<vec4f>;
@group(0) @binding(2) var<storage,read> directLights:DirectLights;
@group(0) @binding(3) var<storage,read_write> sums:array<vec4f>;
/** No proxy: no light here casts a shadow. */
fn proxyBlocked(o:vec3f,d:vec3f,span:f32)->bool{return false;}
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id:vec3u){
 if(id.x>=arrayLength(&sums)){return;}
 sums[id.x]=vec4f(lightsIrradiance(points[2u*id.x].xyz,points[2u*id.x+1u].xyz,1000.0),0.0);
}`,
    [
      DIRECT_LIGHT_WGSL,
      ...(listed ? [lightsIrradianceWgsl(true), BOUNCE_LIGHT_CELL_WGSL] : [LIGHTS_IRRADIANCE_WGSL]),
    ],
  )

/** Runs a dispatch is timed over. */
const TIMED = 9

export async function run(counts: number[]) {
  const opened = await openGpuDevice(['timestamp-query'])
  if (!opened) return { unavailable: 'no WebGPU adapter' } as const
  const { device } = opened
  const timed = device.features.has('timestamp-query')
  const r = lcgRandom(1521)
  const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
  const points = device.createBuffer({ size: POINTS * 32, usage })
  device.queue.writeBuffer(points, 0, pointsOf(r))
  const grid = new ArrayBuffer(BOUNCE_GRID_BYTES)
  new Uint32Array(grid, 16, 4).set([SIDE, 1, 0, 0])
  new Float32Array(grid, 48, 8).set([0, 0, 0, SPACING, BASE, BASE, BASE, 0])
  const uniform = device.createBuffer({
    size: BOUNCE_GRID_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  device.queue.writeBuffer(uniform, 0, grid)
  const tiles = await createGpuLightTiles(device, 'world')
  const pipelines = [false, true].map((listed) =>
    device.createComputePipeline({
      layout: 'auto',
      compute: { module: device.createShaderModule({ code: kernel(listed) }), entryPoint: 'main' },
    }),
  )
  const querySet = timed ? device.createQuerySet({ type: 'timestamp', count: 2 }) : undefined
  const stamps = device.createBuffer({
    size: 16,
    usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
  })
  /** The GPU time of what `encode` puts in one pass, the median of `TIMED` runs. */
  async function timeOf(encode: (pass: GPUComputePassEncoder) => void) {
    const ms: number[] = []
    for (let k = 0; k < TIMED; k++) {
      const encoder = device.createCommandEncoder()
      const pass = encoder.beginComputePass(
        querySet
          ? { timestampWrites: { querySet, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 } }
          : {},
      )
      encode(pass)
      pass.end()
      if (querySet) encoder.resolveQuerySet(querySet, 0, 2, stamps, 0)
      device.queue.submit([encoder.finish()])
      if (!querySet) continue
      const t = new BigUint64Array((await readBuffer(device, stamps, 0, 16)).buffer)
      ms.push(Number(t[1] - t[0]) / 1e6)
    }
    return ms.length ? ms.sort((a, b) => a - b)[ms.length >> 1] : null
  }
  const runs = []
  for (const count of counts) {
    const store = createSceneLightStore()
    for (const light of lightsOf(count, r)) store.add(light)
    const lights = createWebgpuLightState(store)
    lights.buffer = createSceneLightContractBuffer(device, store)
    uploadSceneLights(device, lights)
    tiles.ensureWorld(SIDE, lights.buffer, store.count)
    tiles.updateWorld([BASE * SPACING, BASE * SPACING, BASE * SPACING], SPACING)
    const listing = device.createCommandEncoder()
    tiles.encode(listing, 1)
    device.queue.submit([listing.finish()])
    const results = []
    for (const [listed, pipeline] of pipelines.entries()) {
      const sums = device.createBuffer({
        size: POINTS * 16,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
      })
      // Walking every light reads no grid: the kernel's layout holds no uniform then.
      const entries: GPUBindGroupEntry[] = [
        ...(listed ? [{ binding: 0, resource: { buffer: uniform } }] : []),
        { binding: 1, resource: { buffer: points } },
        { binding: 2, resource: { buffer: lights.buffer } },
        { binding: 3, resource: { buffer: sums } },
      ]
      if (listed)
        entries.push({ binding: BOUNCE_LIGHT_LIST_BINDING, resource: { buffer: tiles.buffer! } })
      const group = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries })
      const ms = await timeOf((pass) => {
        pass.setPipeline(pipeline)
        pass.setBindGroup(0, group)
        pass.dispatchWorkgroups(ceilDiv(POINTS, 64))
      })
      const words = new Uint32Array((await readBuffer(device, sums, 0, POINTS * 16)).buffer)
      results.push({ ms, words: [...words] })
      sums.destroy()
    }
    // The lists' own pass, what a frame the lights change adds: its submission's wall time, the
    // pass holding no timestamp of its own — an upper bound.
    const wall: number[] = []
    for (let k = 0; k < TIMED; k++) {
      const start = performance.now()
      const encoder = device.createCommandEncoder()
      tiles.encode(encoder, 2 + k)
      device.queue.submit([encoder.finish()])
      await device.queue.onSubmittedWorkDone()
      wall.push(performance.now() - start)
    }
    runs.push({
      count,
      listWallMs: wall.sort((a, b) => a - b)[TIMED >> 1],
      all: results[0],
      listed: results[1],
      lit: results[0].words.filter((w, i) => i % 4 < 3 && w !== 0).length,
    })
    lights.buffer.destroy()
  }
  tiles.dispose()
  points.destroy()
  uniform.destroy()
  return { adapter: (await opened.fermer()).court, errors: opened.errors, timed, runs }
}
