// The rest compaction sized by the partition's count of tested rows, on the machine's device: the
// engine's own `createGpuRestCompact` over a table that holds far more instances than the tested
// rows can fill, the dispatch arguments and the compacted lists read back.
import { createGpuRestCompact } from '../../../packages/sdk-browser/src/gpu/raster/restCompact.ts'
import {
  BASE_SLOTS,
  BATCH_SHIFT,
  HALF_SLOTS,
} from '../../../packages/sdk-browser/src/gpu/draw/contract.ts'
import {
  STATE_WORDS,
  ST_TESTED,
  VERDICT_KEPT,
  VERDICT_REJECTED,
} from '../../../packages/sdk-browser/src/gpu/partition/contract.ts'
import { PAGE_INFO_STRIDE, ROW_WORDS } from '../../../packages/sdk-browser/src/visibility/types.ts'
import { heldBuffers } from '../kit/heldBuffers.ts'
import { openGpuDevice } from '../kit/webgpuDevice.ts'
import { readBuffer } from '../kit/computeReadback.ts'

/** Rows the table holds, far more than the image tests. */
const TABLE_ROWS = 20_000
/** Instances a tested row takes at most. */
const PER_ROW = 2
/** Word of a page row holding its Hi-Z slot (`PageInfo.hizSlot`). */
const HIZ_SLOT_WORD = 31

export async function testRestCompaction() {
  const gpu = await openGpuDevice()
  if (!gpu) throw new Error('WebGPU must be available')
  const { device } = gpu
  const { buffer, release } = heldBuffers(device)
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
  const pageWords = new Uint32Array(tested * ROW_WORDS)
  for (let row = 0; row < tested; row++) pageWords[row * ROW_WORDS + HIZ_SLOT_WORD] = row
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
  // The next image tests no row: its slots hold nothing, the earlier image's tile words stay in the
  // work buffer, and the compaction must leave every slot empty, never sum those words.
  device.queue.writeBuffer(indirect, 0, new Uint32Array(BASE_SLOTS * 4))
  device.queue.writeBuffer(partitionState, 0, new Uint32Array(STATE_WORDS))
  recorded = undefined
  const again = device.createCommandEncoder()
  const nextPass = again.beginComputePass()
  const nextOpen = {
    pass: new Proxy(nextPass, {
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
  if (!compact.encode(nextOpen, 2, TABLE_ROWS * PER_ROW, restPages))
    throw new Error('the compaction must run')
  nextPass.end()
  device.queue.submit([again.finish()])
  if (!recorded) throw new Error('the compaction must dispatch on arguments')
  const emptyArgs = [...(await readBuffer(device, recorded, 0, 12))]
  const emptyCommands = await readBuffer(device, indirect, 0, BASE_SLOTS * 16)
  const emptyCounts = slots.map((slot) => emptyCommands[slot * 4 + 1])
  compact.dispose()
  const { court: adapter } = await gpu.fermer()
  release()
  return {
    adapter,
    errors: gpu.errors,
    args: restArgs,
    counts: slots.map((slot) => commandsAfter[slot * 4 + 1]),
    survivors,
    expected,
    empty: { args: emptyArgs, counts: emptyCounts },
  }
}
