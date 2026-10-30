// The engine side of the meshes' fields proof (`mesh-probes.gpu.ts`): a world of the scene (`meshProbesScene.ts`) opened on Dawn lit by the sun, held at
// a pose that sees the ground under the overhanging block, its image captured and, from the runtime the engine kept, the lists of the rays the
// screen probes left to the scene stage and of those the meshes' fields stage traced, counted by the GPU (the lists are storage buffers, not copy sources).
import { SUN } from '../../../bench/runner/lighting/lamps.ts'
import { readGpuBuffer } from '../../../packages/sdk-browser/src/gpu/core/readback.ts'
import type { CameraPose } from '../../../packages/sdk-core/src/contracts/base.ts'
import { runtimeKeepingEngine } from '../../kit/device/pagesRuntime.ts'
import { measurementSdk, proofCanvas } from '../../kit/device/renderHarness.ts'
import { listenToWorldDevices } from '../../kit/device/worldErrors.ts'
import { settle } from '../world/proofWorld.ts'
import { meshProbesManifest } from './meshProbesScene.ts'

/** The size of the image, as the scene-trace proof's. */
export const SIZE: [number, number] = [320, 240]

/** The eye, level with the gap under the block (the block's underside is a metre up), a few metres from it, looking along the ground: it sees the ground under the block's edge. */
export const POSE: CameraPose = {
  position: [0, 0.6, 10],
  target: [0, 0.8, 0],
  fov: 50,
  near: 0.1,
  far: 100,
}

/** A world of the scene: its meshes built with their distance fields or not (`fields`), the screen probes tracing them or not (`trace`: `meshDistanceFieldTrace` and
 *  `screenProbeMeshDistanceFieldTrace` both). */
export type MeshProbesCase = { fields: boolean; trace: boolean }

/** What a case read: its image (RGBA, bottom row first), the rays the screen left to the scene stage and those the meshes' fields stage traced,
 *  the devices' errors and why the world was not ready for the counts. */
export type MeshProbesReading = {
  held: boolean
  pixels: number[]
  sceneRays: number
  meshRays: number
  errors: string[]
  missing?: string
}

/** The word at `index` of `buffer`, read by a compute pass into a buffer that can be copied from. */
async function wordOf(device: GPUDevice, buffer: GPUBuffer, index: number) {
  const out = device.createBuffer({
    size: 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  })
  const module = device.createShaderModule({
    code: `@group(0) @binding(0) var<storage,read> list:array<u32>;
@group(0) @binding(1) var<storage,read_write> word:array<u32>;
@compute @workgroup_size(1) fn main(){word[0]=list[${index}];}`,
  })
  const pipeline = await device.createComputePipelineAsync({
    layout: 'auto',
    compute: { module, entryPoint: 'main' },
  })
  const group = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer } },
      { binding: 1, resource: { buffer: out } },
    ],
  })
  const encoder = device.createCommandEncoder()
  const pass = encoder.beginComputePass()
  pass.setPipeline(pipeline)
  pass.setBindGroup(0, group)
  pass.dispatchWorkgroups(1)
  pass.end()
  device.queue.submit([encoder.finish()])
  const read = await readGpuBuffer(device, out, 4)
  out.destroy()
  return read![0]
}

/** The world of `kind` opened, held at `POSE` and read. */
export async function drawCase({ fields, trace }: MeshProbesCase): Promise<MeshProbesReading> {
  const sink = listenToWorldDevices()
  const { openMeasuredWorld } = await measurementSdk()
  const { factory, runtime } = runtimeKeepingEngine()
  const canvas = proofCanvas('mesh-probes')
  const world = await openMeasuredWorld(canvas, {
    manifestUrl: meshProbesManifest(fields),
    scope: 'full',
    interactive: false,
    width: SIZE[0],
    height: SIZE[1],
    pixelRatio: 1,
    pixelError: 0,
    maxResidentPages: 100000,
    temporalAntialiasing: false,
    engine: factory,
    meshDistanceFieldTrace: trace,
    screenProbeMeshDistanceFieldTrace: trace,
  })
  try {
    world.addLight(SUN)
    world.setPose(POSE)
    await world.awaitPages()
    const held = (await settle(world, POSE)) !== null
    const pixels = Array.from(new Uint8Array(await world.capture()))
    const rt = runtime()
    const probes = rt?.gpu.screenProbes
    const device = rt?.gpu.device
    const reading: MeshProbesReading = {
      held,
      pixels,
      sceneRays: 0,
      meshRays: 0,
      errors: sink.errors,
    }
    if (!device || !probes) {
      reading.missing = 'the screen probes cast no image'
      return reading
    }
    // The head of a list is its indirect arguments (three words), then its count.
    reading.sceneRays = await wordOf(device, probes.resources.sceneRays, 3)
    reading.meshRays = await wordOf(device, probes.resources.meshRays, 3)
    return reading
  } finally {
    world.dispose()
    canvas.remove()
  }
}

/** Every case of `cases`, one world after the other. */
export async function run(cases: MeshProbesCase[]) {
  const readings: MeshProbesReading[] = []
  for (const kind of cases) readings.push(await drawCase(kind))
  return readings
}
