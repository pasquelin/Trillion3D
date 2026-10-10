// The Hi-Z test and the rest compaction sized by the partition's count of tested rows, on the
// machine's device: the engine's own pipelines and its own `createGpuRestCompact`, a table that
// holds far more rows than the image tests, the dispatch arguments and the results read back.
import {
  createHizPipelines,
  hizArgsGroup,
} from '../../../packages/sdk-browser/src/gpu/hiz/pipelines.ts'
import { HIZ_SLOT_WORDS } from '../../../packages/sdk-browser/src/gpu/hiz/uniforms.ts'
import { createGpuRestCompact } from '../../../packages/sdk-browser/src/gpu/raster/restCompact.ts'
import { BATCH_SHIFT } from '../../../packages/sdk-browser/src/gpu/draw/contract.ts'
import { BASE_SLOTS, HALF_SLOTS } from '../../../packages/sdk-browser/src/gpu/draw/contract.ts'
import {
  STATE_WORDS,
  ST_TESTED,
  TESTED_U32,
  VERDICT_KEPT,
  VERDICT_REJECTED,
} from '../../../packages/sdk-browser/src/gpu/partition/contract.ts'
import {
  HIZ_FARTHEST,
  HIZ_FORMAT,
  hizTextureSize,
} from '../../../packages/sdk-browser/src/gpu/hiz/pyramidTexture.ts'
import { hizFarthestLayer } from '../../../packages/sdk-browser/src/gpu/hiz/oracle.fixture.ts'
import { PAGE_INFO_STRIDE } from '../../../packages/sdk-browser/src/visibility/types.ts'
import { openGpuDevice } from '../kit/webgpuDevice.ts'
import { readBuffer } from '../kit/computeReadback.ts'
import { BOX_NEAREST, CASES } from './occlusionTestCases.ts'

/** Rows the table holds, far more than the image tests. */
export const TABLE_ROWS = 20_000
/** Instances a tested row takes at most. */
export const PER_ROW = 2
/** Word of a page row holding its Hi-Z slot (`PageInfo.hizSlot`). */
const HIZ_SLOT_WORD = 31
const UNIFORM_BYTES = 256

export interface TestedArgsRun {
  adapter: string
  errors: string[]
  /** For each count of tested boxes: the arguments `testHizArgs` wrote, the verdicts the test
   *  wrote on them, and the verdicts a dispatch over the whole table writes. */
  hiz: { tested: number; args: number[]; flags: number[]; whole: number[] }[]
  /** The arguments of a count past one dimension of a dispatch. */
  wideArgs: number[]
  rest: {
    args: number[]
    counts: number[]
    survivors: number[][]
    expected: number[][]
  }
}

export async function testTestedArgs(counts: number[]): Promise<TestedArgsRun> {
  const gpu = await openGpuDevice()
  if (!gpu) throw new Error('WebGPU must be available')
  const { device } = gpu
  const made: GPUBuffer[] = []
  const buffer = (size: number, usage: number) => {
    const created = device.createBuffer({ size, usage })
    made.push(created)
    return created
  }
  const pipelines = await createHizPipelines(device)
  if (!pipelines) throw new Error('the Hi-Z pipelines must compile')
  const [sample] = CASES

  // The Hi-Z test: one pyramid, a case that rejects, `tested` boxes of it in a table of TABLE_ROWS.
  const level0 = device.createTexture({
    size: [1, 1],
    format: 'r32float',
    usage: GPUTextureUsage.TEXTURE_BINDING,
  })
  const pyramid = device.createTexture({
    size: hizTextureSize(sample.pyramid.length),
    format: HIZ_FORMAT,
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_DST,
  })
  const layer = hizFarthestLayer(sample.pyramid)
  device.queue.writeTexture(
    { texture: pyramid, origin: [0, 0, HIZ_FARTHEST] },
    layer.words,
    { bytesPerRow: layer.width * 4 },
    [layer.width, layer.height, 1],
  )
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
      entries: [
        { binding: 0, resource: pyramid.createView({ dimension: '2d-array' }) },
        { binding: 1, resource: level0.createView() },
        { binding: 2, resource: { buffer: uniform, size: HIZ_SLOT_WORDS * 4 } },
        { binding: 3, resource: { buffer: bounds } },
        { binding: 4, resource: { buffer: flags } },
        { binding: 5, resource: { buffer: state } },
      ],
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
      pass.dispatchWorkgroups(Math.ceil(TABLE_ROWS / 64))
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

  const rest = await restRun()
  const { court: adapter } = await gpu.fermer()
  for (const created of made) created.destroy()
  return { adapter, errors: gpu.errors, hiz, wideArgs, rest }

  /** The compaction on two tested slots of a table of TABLE_ROWS rows, 100 of them tested. */
  async function restRun() {
    const tested = 100,
      slots = [HALF_SLOTS, HALF_SLOTS + 1],
      lengths = [130, 200],
      starts = [0, 256]
    const instances = buffer(
      1024 * 4,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    )
    const indirect = buffer(
      BASE_SLOTS * 16,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    )
    const offsets = buffer(BASE_SLOTS * 4, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST)
    const verdicts = buffer(tested * 4, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST)
    const restPages = buffer(
      tested * PAGE_INFO_STRIDE,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    )
    const partitionState = buffer(STATE_WORDS * 4, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST)
    const wordsOf = new Uint32Array(1024)
    const rejected = (row: number) => row % 3 === 0
    slots.forEach((_, k) => {
      for (let x = 0; x < lengths[k]; x++)
        wordsOf[starts[k] + x] = ((x * 7) % tested) | ((x % PER_ROW) << BATCH_SHIFT)
    })
    device.queue.writeBuffer(instances, 0, wordsOf)
    const commands = new Uint32Array(BASE_SLOTS * 4),
      slotStarts = new Uint32Array(BASE_SLOTS)
    slots.forEach((slot, k) => {
      commands[slot * 4 + 1] = lengths[k]
      slotStarts[slot] = starts[k]
    })
    device.queue.writeBuffer(indirect, 0, commands)
    device.queue.writeBuffer(offsets, 0, slotStarts)
    const verdictWords = new Uint32Array(tested).map((_, row) =>
      rejected(row) ? VERDICT_REJECTED : VERDICT_KEPT,
    )
    device.queue.writeBuffer(verdicts, 0, verdictWords)
    const pageWords = new Uint32Array((tested * PAGE_INFO_STRIDE) / 4)
    for (let row = 0; row < tested; row++)
      pageWords[row * (PAGE_INFO_STRIDE / 4) + HIZ_SLOT_WORD] = row
    device.queue.writeBuffer(restPages, 0, pageWords)
    const counted = new Uint32Array(STATE_WORDS)
    counted[ST_TESTED] = tested
    device.queue.writeBuffer(partitionState, 0, counted)

    const compact = await createGpuRestCompact(device, {
      state: partitionState,
      perRow: PER_ROW,
      instances,
      indirect,
      slotOffsets: offsets,
      flags: verdicts,
    })
    if (!compact) throw new Error('the rest compaction must compile')
    let recorded: GPUBuffer | undefined
    const encoder = device.createCommandEncoder()
    const pass = encoder.beginComputePass()
    const open = {
      pass: new Proxy(pass, {
        get(target, name) {
          if (name === 'dispatchWorkgroupsIndirect')
            return (arguments_: GPUBuffer, at: number) => {
              recorded = arguments_
              target.dispatchWorkgroupsIndirect(arguments_, at)
            }
          const member = Reflect.get(target, name)
          return typeof member === 'function' ? member.bind(target) : member
        },
      }),
    }
    // The table's capacity in instances: far more than the tested rows can fill.
    if (!compact.encode(open, 2, TABLE_ROWS * PER_ROW, restPages))
      throw new Error('the compaction must run')
    pass.end()
    device.queue.submit([encoder.finish()])
    if (!recorded) throw new Error('the compaction must dispatch on arguments')
    const restArgs = [...(await readBuffer(device, recorded, 0, 12))]
    const after = await readBuffer(device, instances, 0, 1024 * 4)
    const commandsAfter = await readBuffer(device, indirect, 0, BASE_SLOTS * 16)
    const survivors: number[][] = [],
      expected: number[][] = []
    slots.forEach((slot, k) => {
      const kept = [...wordsOf.subarray(starts[k], starts[k] + lengths[k])].filter(
        (word) => !rejected(word & ((1 << BATCH_SHIFT) - 1)),
      )
      expected.push(kept)
      survivors.push([...after.subarray(starts[k], starts[k] + commandsAfter[slot * 4 + 1])])
    })
    compact.dispose()
    return {
      args: restArgs,
      counts: slots.map((slot) => commandsAfter[slot * 4 + 1]),
      survivors,
      expected,
    }
  }
}
