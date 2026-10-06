// The engine's Hi-Z test kernel (`testHiz`, `gpu/hiz/shader.ts`) on the machine's device: one
// dispatch per case, the box laid out as the partition packs it (`Bounds`, `TESTED_U32` words),
// the verdict read back.
import {
  HIZ_SHADER,
  HIZ_TEST_PAGES_ENTRIES,
  hizBindEntries,
} from '../../../packages/sdk-browser/src/gpu/hiz/shader.ts'
import { PAGE_INFO_STRIDE } from '../../../packages/sdk-browser/src/visibility/types.ts'
import {
  STATE_WORDS,
  ST_TESTED,
  TESTED_U32,
} from '../../../packages/sdk-browser/src/gpu/partition/contract.ts'
import { openGpuDevice } from '../kit/webgpuDevice.ts'
import { BOX_NEAREST, type OcclusionCase } from './occlusionTestCases.ts'

/** Bytes of the test's uniform block, bound at a dynamic offset. */
const UNIFORM_BYTES = 256
/** Words of `Bounds` the cases fill: the rectangle, then these. */
const NEAREST = 4,
  ROW_AND_CLIP = 5,
  FINE_OFFSET = 6,
  FINE_WIDTH = 7

export async function testOcclusion(cases: OcclusionCase[]) {
  const gpu = await openGpuDevice()
  if (!gpu) throw new Error('WebGPU must be available')
  const { device } = gpu
  const { module, compilation } = await gpu.compile(HIZ_SHADER)
  if (compilation.length) throw new Error(`the Hi-Z shader does not compile: ${compilation}`)
  const layout = device.createBindGroupLayout({ entries: hizBindEntries(UNIFORM_BYTES) }),
    pagesLayout = device.createBindGroupLayout({ entries: HIZ_TEST_PAGES_ENTRIES })
  const pipeline = device.createComputePipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout, pagesLayout] }),
    compute: { module, entryPoint: 'testHiz' },
  })
  const buffer = (size: number, usage: GPUBufferUsageFlags) => device.createBuffer({ size, usage })
  const level0 = device.createTexture({
    size: [1, 1],
    format: 'r32float',
    usage: GPUTextureUsage.TEXTURE_BINDING,
  })
  // A zero block: counters off (`uni.counting`), and nothing else the test reads.
  const uniform = buffer(UNIFORM_BYTES, GPUBufferUsage.UNIFORM)
  const bounds = buffer(TESTED_U32 * 4, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST)
  const flags = buffer(4, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC)
  const state = buffer(STATE_WORDS * 4, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST)
  // One zeroed page row: Hi-Z slot 0, a row the pyramid judges.
  const pages = buffer(PAGE_INFO_STRIDE, GPUBufferUsage.STORAGE)
  const readback = buffer(4, GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ)
  const pagesGroup = device.createBindGroup({
    layout: pagesLayout,
    entries: [{ binding: 0, resource: { buffer: pages } }],
  })
  const verdicts = []
  for (const sample of cases) {
    const box = new ArrayBuffer(TESTED_U32 * 4),
      words = new Uint32Array(box)
    new Int32Array(box).set(sample.rectangle)
    new Float32Array(box)[NEAREST] = BOX_NEAREST
    words[ROW_AND_CLIP] = sample.clipsNear ? 1 : 0
    words[FINE_OFFSET] = sample.fineOffset
    words[FINE_WIDTH] = sample.fineWidth
    device.queue.writeBuffer(bounds, 0, box)
    const counters = new Uint32Array(STATE_WORDS)
    counters[ST_TESTED] = 1
    device.queue.writeBuffer(state, 0, counters)
    const pyramid = buffer(
      sample.pyramid.byteLength,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    )
    device.queue.writeBuffer(pyramid, 0, sample.pyramid)
    const group = device.createBindGroup({
      layout,
      entries: [
        { binding: 0, resource: { buffer: pyramid } },
        { binding: 1, resource: level0.createView() },
        { binding: 2, resource: { buffer: uniform, size: UNIFORM_BYTES } },
        { binding: 3, resource: { buffer: bounds } },
        { binding: 4, resource: { buffer: flags } },
        { binding: 5, resource: { buffer: state } },
      ],
    })
    const encoder = device.createCommandEncoder()
    const pass = encoder.beginComputePass()
    pass.setPipeline(pipeline)
    pass.setBindGroup(0, group, [0])
    pass.setBindGroup(1, pagesGroup)
    pass.dispatchWorkgroups(1)
    pass.end()
    encoder.copyBufferToBuffer(flags, 0, readback, 0, 4)
    device.queue.submit([encoder.finish()])
    await readback.mapAsync(GPUMapMode.READ)
    verdicts.push(new Uint32Array(readback.getMappedRange().slice(0))[0])
    readback.unmap()
    pyramid.destroy()
  }
  const { court: adapter } = await gpu.fermer()
  return { adapter, verdicts, errors: gpu.errors }
}
