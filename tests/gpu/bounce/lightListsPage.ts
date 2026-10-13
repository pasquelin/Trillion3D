// Page of the bounce's world light lists proof (`light-lists.gpu.ts`): the light grid's world pass
// over a generated lattice (`createGpuLightTiles`), then the one irradiance every bounce reader sums
// (`lightsIrradiance`) at generated points, once walking each point's cell list and once with no
// lists — the very loop, every light (`bounceLightSlice`) —, both read back; each walk and the
// lists' rebuild timed on the GPU, interleaved.
import { BOUNCE_SETTINGS, createSceneLightStore } from '../../../packages/sdk-core/src/index.ts'
import { lcgRandom } from '../../../packages/math/src/sequence/random.ts'
import { ceilDiv } from '../../../packages/math/src/scalar/integers.ts'
import { createGpuLightTiles } from '../../../packages/sdk-browser/src/lighting/tiles/tiles.ts'
import {
  createSceneLightContractBuffer,
  uploadSceneLights,
} from '../../../packages/sdk-browser/src/webgpu/pages/state/lightBuffer.ts'
import { createWebgpuLightState } from '../../../packages/sdk-browser/src/webgpu/pages/state/lights.ts'
import { DIRECT_LIGHT_WGSL } from '../../../packages/sdk-browser/src/lighting/direct/lightWgsl.ts'
import { LIGHTS_IRRADIANCE_WGSL } from '../../../packages/sdk-browser/src/lighting/direct/lightLoopWgsl.ts'
import {
  BOUNCE_LIGHT_CELL_WGSL,
  BOUNCE_LIGHT_LIST_BINDING,
} from '../../../packages/sdk-browser/src/bounce/lightCellWgsl.ts'
import { BOUNCE_GRID_BYTES } from '../../../packages/sdk-browser/src/bounce/uniform.ts'
import { TILE_STRIDE_WORDS } from '../../../packages/sdk-browser/src/lighting/direct/lightWgsl.ts'
import { wgslProgram } from '../../../packages/math/src/wgsl/assemble.ts'
import { readBuffer } from '../kit/computeReadback.ts'
import { openGpuDevice } from '../kit/webgpuDevice.ts'
import { BASE, POINTS, SIDE, SPACING, lightsOf, pointsOf } from './lightListsScene.ts'

/** Interleaved timings of each dispatch. */
const REPEATS = 9
const NONE = 0xffffffff

/** Point i's irradiance into word 4i, over the cascades' uniform and the light grid's buffer. */
const KERNEL = wgslProgram(
  `struct BounceLevel{originSpacing:vec4f,base:vec4f,}
struct BounceGrid{reach:vec4f,counts:vec4u,frame:vec4u,lists:vec4u,levels:array<BounceLevel,${BOUNCE_SETTINGS.cascadeLevels}>,}
@group(0) @binding(0) var<uniform> bounce:BounceGrid;
@group(0) @binding(1) var<storage,read> points:array<vec4f>;
@group(0) @binding(2) var<storage,read> directLights:DirectLights;
@group(0) @binding(3) var<storage,read_write> sums:array<vec4f>;
@group(0) @binding(${BOUNCE_LIGHT_LIST_BINDING}) var<storage,read> tileLights:array<u32>;
/** No proxy: no light here casts a shadow. */
fn rtBlocked(o:vec3f,d:vec3f,span:f32)->bool{return false;}
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id:vec3u){
 if(id.x>=arrayLength(&sums)){return;}
 sums[id.x]=vec4f(lightsIrradiance(points[2u*id.x].xyz,points[2u*id.x+1u].xyz,1000.0),0.0);
}`,
  [DIRECT_LIGHT_WGSL, LIGHTS_IRRADIANCE_WGSL, BOUNCE_LIGHT_CELL_WGSL],
)

export type ListSet = { count: number; reach: number; coherent: boolean }

export async function run(sets: ListSet[]) {
  const opened = await openGpuDevice(['timestamp-query'])
  if (!opened) return { unavailable: 'no WebGPU adapter' } as const
  const { device } = opened
  const r = lcgRandom(1521)
  const tiles = await createGpuLightTiles(device)
  const pipeline = device.createComputePipeline({
    layout: 'auto',
    compute: { module: device.createShaderModule({ code: KERNEL }), entryPoint: 'main' },
  })
  const querySet = device.features.has('timestamp-query')
    ? device.createQuerySet({ type: 'timestamp', count: 2 })
    : undefined
  const stamps = device.createBuffer({
    size: 16,
    usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
  })
  /** The cascades' uniform of one level, the lattice, its lists at `start` (`NONE`: none). */
  const gridOf = (start: number) => {
    const grid = new ArrayBuffer(BOUNCE_GRID_BYTES)
    new Uint32Array(grid, 16, 12).set([SIDE, 1, 0, 0, 0, 0, 0, 0, start, 0, 0, 0])
    new Float32Array(grid, 64, 8).set([0, 0, 0, SPACING, BASE, BASE, BASE, 1 / SPACING])
    const buffer = device.createBuffer({
      size: BOUNCE_GRID_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
    device.queue.writeBuffer(buffer, 0, grid)
    return buffer
  }
  /** The GPU time of the one compute pass `encode` begins, its timestamps put on it here. */
  async function timeOf(encode: (encoder: GPUCommandEncoder) => void) {
    const encoder = device.createCommandEncoder()
    if (querySet) {
      const begin = encoder.beginComputePass.bind(encoder)
      encoder.beginComputePass = (descriptor?: GPUComputePassDescriptor) =>
        begin({
          ...descriptor,
          timestampWrites: { querySet, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 },
        })
    }
    encode(encoder)
    if (querySet) encoder.resolveQuerySet(querySet, 0, 2, stamps, 0)
    device.queue.submit([encoder.finish()])
    if (!querySet) return NaN
    const t = new BigUint64Array((await readBuffer(device, stamps, 0, 16)).buffer)
    return Number(t[1] - t[0]) / 1e6
  }
  const runs = []
  for (const { count, reach, coherent } of sets) {
    const points = device.createBuffer({
      size: POINTS * 32,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })
    device.queue.writeBuffer(points, 0, pointsOf(r, coherent))
    const store = createSceneLightStore()
    for (const light of lightsOf(count, reach, r)) store.add(light)
    const lights = createWebgpuLightState(store)
    lights.buffer = createSceneLightContractBuffer(device, store)
    uploadSceneLights(device, lights)
    // Listed until no column overflows its pool: the pool grows from what a frame sampled.
    const corner = [BASE * SPACING, BASE * SPACING, BASE * SPACING]
    let fallbacks = Infinity
    for (let frame = 1; frame < 12 && fallbacks > 0; frame++) {
      tiles.ensureWorld(SIDE, lights.buffer, store.count)
      tiles.updateWorld(corner, SPACING)
      const encoder = device.createCommandEncoder()
      tiles.encodeWorld(encoder, frame)
      device.queue.submit([encoder.finish()])
      tiles.submitted()
      await device.queue.onSubmittedWorkDone()
      await new Promise((settled) => setTimeout(settled, 20))
      const records = new Uint32Array(
        (await readBuffer(device, tiles.buffer!, tiles.worldStart * 4, SIDE ** 3 * 8)).buffer,
      )
      fallbacks = 0
      for (let cell = 0; cell < SIDE ** 3; cell++)
        if (records[cell * TILE_STRIDE_WORDS + 1] === NONE) fallbacks++
    }
    const kernels = [NONE, tiles.worldStart].map((start) => {
      const uniform = gridOf(start)
      const sums = device.createBuffer({
        size: POINTS * 16,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
      })
      const group = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: uniform } },
          { binding: 1, resource: { buffer: points } },
          { binding: 2, resource: { buffer: lights.buffer! } },
          { binding: 3, resource: { buffer: sums } },
          { binding: BOUNCE_LIGHT_LIST_BINDING, resource: { buffer: tiles.buffer! } },
        ],
      })
      const encode = (encoder: GPUCommandEncoder) => {
        const pass = encoder.beginComputePass()
        pass.setPipeline(pipeline)
        pass.setBindGroup(0, group)
        pass.dispatchWorkgroups(ceilDiv(POINTS, 64))
        pass.end()
      }
      return { uniform, sums, encode }
    })
    // Interleaved: every light, the listed walk, then the lists' rebuild — what every frame of
    // lights that all move costs —, `REPEATS` times.
    const ms = { all: [] as number[], listed: [] as number[], build: [] as number[] }
    for (let k = 0; k < REPEATS; k++) {
      ms.all.push(await timeOf(kernels[0].encode))
      ms.listed.push(await timeOf(kernels[1].encode))
      ms.build.push(await timeOf((encoder) => tiles.encodeWorld(encoder, 100 + k)))
    }
    const words = await Promise.all(
      kernels.map(async ({ sums }) => [
        ...new Uint32Array((await readBuffer(device, sums, 0, POINTS * 16)).buffer),
      ]),
    )
    for (const { uniform, sums } of kernels) {
      uniform.destroy()
      sums.destroy()
    }
    runs.push({
      count,
      reach,
      coherent,
      fallbacks,
      ms,
      all: words[0],
      listed: words[1],
      lit: words[0].filter((w, i) => i % 4 < 3 && w !== 0).length,
    })
    points.destroy()
    lights.buffer.destroy()
  }
  tiles.dispose()
  return { adapter: (await opened.fermer()).court, errors: opened.errors, runs }
}
