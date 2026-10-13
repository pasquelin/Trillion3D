// The Hi-Z test sized by the partition's count of tested rows, on the machine's device: the
// engine's own pipelines, a table that holds far more rows than the image tests, the dispatch
// arguments and the verdicts read back.
import {
  createHizPipelines,
  hizArgsGroup,
} from '../../../packages/sdk-browser/src/gpu/hiz/pipelines.ts'
import { HIZ_SLOT_WORDS } from '../../../packages/sdk-browser/src/gpu/hiz/uniforms.ts'
import {
  STATE_WORDS,
  ST_TESTED,
  TESTED_U32,
} from '../../../packages/sdk-browser/src/gpu/partition/contract.ts'
import { PAGE_INFO_STRIDE } from '../../../packages/sdk-browser/src/visibility/types.ts'
import { ceilDiv } from '../../../packages/math/src/scalar/integers.ts'
import { hizEntries, laidPyramid } from './casePyramid.ts'
import { openGpuDevice } from '../kit/webgpuDevice.ts'
import { readBuffer } from '../kit/computeReadback.ts'
import { BOX_NEAREST, CASES, UNIFORM_BYTES } from './occlusionTestCases.ts'

/** Rows the table holds, far more than the image tests. */
const TABLE_ROWS = 20_000

export interface TestedArgsRun {
  adapter: string
  errors: string[]
  /** For each count of tested boxes: the arguments `testHizArgs` wrote, the verdicts the test
   *  wrote on them, and the verdicts a dispatch over the whole table writes. */
  hiz: { tested: number; args: number[]; flags: number[]; whole: number[] }[]
  /** The arguments of a count past one dimension of a dispatch. */
  wideArgs: number[]
}

export async function testTestedArgs(counts: number[]): Promise<TestedArgsRun> {
  const gpu = await openGpuDevice()
  if (!gpu) throw new Error('WebGPU must be available')
  const { device, buffer } = gpu
  const pipelines = await createHizPipelines(device)
  if (!pipelines) throw new Error('the Hi-Z pipelines must compile')
  const [sample] = CASES

  // The Hi-Z test: one pyramid, a case that rejects, `tested` boxes of it in a table of TABLE_ROWS.
  const level0 = device.createTexture({
    size: [1, 1],
    format: 'r32float',
    usage: GPUTextureUsage.TEXTURE_BINDING,
  })
  const pyramid = laidPyramid(device, sample.packed)
  const uniform = buffer(UNIFORM_BYTES, GPUBufferUsage.UNIFORM)
  const bounds = buffer(
    TABLE_ROWS * TESTED_U32 * 4,
    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  )
  const pages = buffer(TABLE_ROWS * PAGE_INFO_STRIDE, GPUBufferUsage.STORAGE)
  const state = buffer(STATE_WORDS * 4, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST)
  const args = buffer(
    12,
    GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_SRC,
  )
  const pagesGroup = device.createBindGroup({
    layout: pipelines.pagesLayout,
    entries: [{ binding: 0, resource: { buffer: pages } }],
  })
  const argsGroup = hizArgsGroup(device, pipelines.argsLayout, args)
  const flagsOf = () => buffer(TABLE_ROWS * 4, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC)
  const group = (flags: GPUBuffer) =>
    device.createBindGroup({
      layout: pipelines.layout,
      entries: hizEntries(pyramid, level0, { buffer: uniform, size: HIZ_SLOT_WORDS * 4 }, [
        bounds,
        flags,
        state,
      ]),
    })
  const submit = (record: (pass: GPUComputePassEncoder) => void) => {
    const encoder = device.createCommandEncoder()
    const pass = encoder.beginComputePass()
    record(pass)
    pass.end()
    device.queue.submit([encoder.finish()])
  }
  const hiz: TestedArgsRun['hiz'] = []
  for (const tested of counts) {
    const boxes = new ArrayBuffer(TABLE_ROWS * TESTED_U32 * 4),
      words = new Uint32Array(boxes)
    for (let i = 0; i < tested; i++) {
      const at = i * TESTED_U32
      new Int32Array(boxes).set(sample.rectangle, at)
      new Float32Array(boxes)[at + 4] = BOX_NEAREST
      words[at + 5] = i << 1
      words[at + 6] = sample.fineOffset
      words[at + 7] = sample.fineWidth
    }
    device.queue.writeBuffer(bounds, 0, boxes)
    const counters = new Uint32Array(STATE_WORDS)
    counters[ST_TESTED] = tested
    device.queue.writeBuffer(state, 0, counters)
    const sized = flagsOf(),
      whole = flagsOf()
    submit((pass) => {
      pass.setBindGroup(0, group(sized), [0])
      pass.setBindGroup(1, argsGroup)
      pass.setPipeline(pipelines.argsPipeline)
      pass.dispatchWorkgroups(1)
      pass.setBindGroup(1, pagesGroup)
      pass.setPipeline(pipelines.testPipeline)
      pass.dispatchWorkgroupsIndirect(args, 0)
    })
    // What the test did before: a dispatch over every row of the table.
    submit((pass) => {
      pass.setBindGroup(0, group(whole), [0])
      pass.setBindGroup(1, pagesGroup)
      pass.setPipeline(pipelines.testPipeline)
      pass.dispatchWorkgroups(ceilDiv(TABLE_ROWS, 64))
    })
    hiz.push({
      tested,
      args: [...(await readBuffer(device, args, 0, 12))],
      flags: [...(await readBuffer(device, sized, 0, TABLE_ROWS * 4))],
      whole: [...(await readBuffer(device, whole, 0, TABLE_ROWS * 4))],
    })
  }
  // A count of boxes past one dimension of a dispatch: the arguments alone, nothing dispatched.
  const counters = new Uint32Array(STATE_WORDS)
  counters[ST_TESTED] = 2 * 65_535 * 64 + 1
  device.queue.writeBuffer(state, 0, counters)
  submit((pass) => {
    pass.setBindGroup(0, group(flagsOf()), [0])
    pass.setBindGroup(1, argsGroup)
    pass.setPipeline(pipelines.argsPipeline)
    pass.dispatchWorkgroups(1)
  })
  const wideArgs = [...(await readBuffer(device, args, 0, 12))]

  const { court: adapter } = await gpu.fermer()
  return { adapter, errors: gpu.errors, hiz, wideArgs }
}
