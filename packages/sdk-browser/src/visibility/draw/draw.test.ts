import { installGpuGlobals } from '../../../../../tests/kit/fakeDevice/globals.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { BACKEND, writtenBytes } from '../../../../../tests/kit/fakeDevice/fakeRecords.ts'
import { packDrawIndirect, evaluateDrawCompact, indirectForDraw } from './cpu.fixture.ts'
import {
  BASE_SLOTS,
  BIN_BACK,
  BIN_FRONT,
  BIN_KIND,
  BIN_NONE,
  CULL_BINS,
  HALF_SLOTS,
  DRAW_ITEM_U32,
  RASTER_HARDWARE,
  RASTER_SOFTWARE,
  drawIndirectBytes,
} from './contract.ts'
import { createGpuDraw } from './factory.ts'

import type { DrawItem } from './cpu.fixture.ts'
import { drawShader } from './shader.ts'

const DRAW_SHADER = drawShader(1)

test('compact keeps input order inside each bin and writes 16-byte indirects', () => {
  const items = [
    { pageIndex: 4, bin: 0 as const, rest: 0 as const },
    { pageIndex: 1, bin: 1 as const, rest: 0 as const },
    { pageIndex: 7, bin: 0 as const, rest: 0 as const },
  ]
  const result = evaluateDrawCompact(items, 768, 8)
  assert.equal(result.overflow, false)
  assert.deepEqual([...result.instances.subarray(0, 3)], [4, 7, 1])
  const back = result.indirect.subarray(0, 4)
  assert.deepEqual([...back], [...packDrawIndirect(768, 2)])
  const none = result.indirect.subarray(4, 8)
  const expectedNone = packDrawIndirect(768, 1)
  expectedNone[3] = 2
  assert.deepEqual([...none], [...expectedNone])
})

test('compact overflow sets the flag and writes zero instance counts', () => {
  const items = [{ pageIndex: 0, bin: 0 as const, rest: 0 as const }]
  const result = evaluateDrawCompact(items, 768, 0)
  assert.equal(result.overflow, true)
  assert.equal(result.indirect[1], 0)
})

test('compact rest pass occupies the second half of the slots with exclusive-scan firstInstance', () => {
  const items: DrawItem[] = [
    { pageIndex: 4, bin: BIN_BACK, rest: 0 },
    { pageIndex: 9, bin: BIN_BACK, rest: 1 },
    { pageIndex: 7, bin: BIN_BACK, rest: 0 },
    { pageIndex: 2, bin: BIN_FRONT, rest: 1 },
    // A cutout row: its face mode's cutout bin, after the opaque bins of its half.
    { pageIndex: 5, bin: BIN_NONE + CULL_BINS, rest: 0 },
  ]
  const result = evaluateDrawCompact(items, 768, 8)
  assert.equal(result.overflow, false)
  assert.deepEqual([...result.instances], [4, 7, 5, 9, 2])
  // Each half: the opaque, the cutout, the voxel and the software bins (`BIN_KIND`), three face
  // modes each; the main half holds the two back rows and the cutout, the post half a back and a
  // front.
  const half = (...modes: number[]) => [
    ...modes,
    ...Array<number>(HALF_SLOTS - modes.length).fill(0),
  ]
  assert.deepEqual([...result.counts], [...half(2, 0, 0, 0, 1), ...half(1, 0, 1)])
  assert.equal(result.counts.length, BASE_SLOTS)
  assert.deepEqual([...result.indirect.subarray(0, 4)], [...packDrawIndirect(768, 2)])
  const restBack = result.indirect.subarray(HALF_SLOTS * 4, (HALF_SLOTS + 1) * 4)
  const expectedRestBack = packDrawIndirect(768, 1)
  expectedRestBack[3] = 3
  assert.deepEqual([...restBack], [...expectedRestBack])
  const restFront = result.indirect.subarray((HALF_SLOTS + 2) * 4, (HALF_SLOTS + 3) * 4)
  const expectedRestFront = packDrawIndirect(768, 1)
  expectedRestFront[3] = 4
  assert.deepEqual([...restFront], [...expectedRestFront])
  assert.equal(BIN_NONE, 1)
})

test('a row the software raster draws takes the software bin of its face mode, any kind', () => {
  const items: DrawItem[] = [
    { pageIndex: 3, bin: BIN_FRONT, rest: 0, raster: RASTER_SOFTWARE },
    { pageIndex: 6, bin: BIN_NONE + CULL_BINS, rest: 1, raster: RASTER_SOFTWARE },
    { pageIndex: 8, bin: BIN_FRONT, rest: 0, raster: RASTER_HARDWARE },
  ]
  const result = evaluateDrawCompact(items, 768, 8)
  const software = BIN_KIND.SOFTWARE * CULL_BINS
  assert.equal(result.counts[BIN_FRONT], 1, 'the hardware row keeps its own slot')
  assert.equal(result.counts[software + BIN_FRONT], 1)
  assert.equal(result.counts[HALF_SLOTS + software + BIN_NONE], 1)
  assert.equal(
    result.counts.reduce((sum, count) => sum + count, 0),
    items.length,
  )
})

test('overflow zeros instance counts in every indirect slot', () => {
  const result = evaluateDrawCompact([{ pageIndex: 0, bin: 0, rest: 0 }], 768, 0)
  for (let s = 0; s < BASE_SLOTS; s++) assert.equal(result.indirect[s * 4 + 1], 0)
  assert.equal(result.instances.length, 0)
})

test('draw shader counts, prefixes and scatters page groups in parallel with stable order', () => {
  assert.doesNotMatch(DRAW_SHADER, /@compute @workgroup_size\(1\)/)
  assert.match(DRAW_SHADER, /@compute @workgroup_size\(WORKGROUP_THREADS\)\s*fn countGroups/)
  assert.match(DRAW_SHADER, /@compute @workgroup_size\(WORKGROUP_THREADS\)\s*fn scatterGroups/)
  assert.match(DRAW_SHADER, /@compute @workgroup_size\(WORKGROUP_THREADS\)\s*fn prefixGroups/)
  assert.match(DRAW_SHADER, /workgroupBarrier\(\);/)
  // The atomic adds tally a group's slots in workgroup memory and sum each slot's total, whatever
  // the groups' order: no global counter decides where an item lands — the prefix does —, so the
  // order stays that of the items.
  assert.deepEqual(DRAW_SHADER.match(/atomicAdd\(&\w+(\[\w+)?/g), [
    'atomicAdd(&slotTally[s',
    'atomicAdd(&indirect[slotTotalAt',
  ])
  // A half's run keeps the rows its mask holds, each in its slot of that half.
  assert.ok(DRAW_SHADER.includes('if(!selected(item)){return NO_INDEX;}'))
  assert.ok(DRAW_SHADER.includes('return slotOf(0u,item);'))
  assert.ok(DRAW_SHADER.includes(`rest*${HALF_SLOTS}u+binOf(item)`))
  assert.ok(DRAW_SHADER.includes('atomicStore(&indirect[o+3u],0u)'))
})

test('draw consumers zero firstInstance while compact records slot starts', () => {
  const items: DrawItem[] = [
    { pageIndex: 0, bin: BIN_BACK, rest: 0 },
    { pageIndex: 1, bin: BIN_NONE, rest: 0 },
    { pageIndex: 2, bin: BIN_BACK, rest: 1 },
  ]
  const result = evaluateDrawCompact(items, 768, 8)
  assert.equal(result.indirect[3], 0)
  assert.equal(result.indirect[7], 1)
  assert.equal(result.indirect[HALF_SLOTS * 4 + 3], 2)
  const drawn = indirectForDraw(result)
  for (let s = 0; s < BASE_SLOTS; s++) assert.equal(drawn[s * 4 + 3], 0)
  assert.equal(drawn[1], 1)
  assert.equal(drawn[5], 1)
  assert.equal(drawn[HALF_SLOTS * 4 + 1], 1)
})

test('a draw with no slot is not created', async () => {
  assert.equal(await createGpuDraw(fakeDevice().device, 0, 1, 768), undefined)
})

test('a compact shader compilation error leaves GPU draw undefined', async () => {
  installGpuGlobals()
  const { device } = fakeDevice({ ...BACKEND, failCompile: true })
  assert.equal(await createGpuDraw(device, 8, 1, 768), undefined)
})

test('GPU draw uploads each item once without a CPU compact and exposes GPU slot offsets', async () => {
  installGpuGlobals()
  const { device, buffers, writes } = fakeDevice(BACKEND)
  const gpu = await createGpuDraw(device, 8, 1, 768)
  assert.ok(gpu)
  assert.equal(gpu.indirectBuffer.size, drawIndirectBytes(BASE_SLOTS))
  assert.equal(
    gpu.indirectBuffer.usage &
      (GPUBufferUsage.INDIRECT |
        GPUBufferUsage.STORAGE |
        GPUBufferUsage.COPY_DST |
        GPUBufferUsage.COPY_SRC),
    GPUBufferUsage.INDIRECT |
      GPUBufferUsage.STORAGE |
      GPUBufferUsage.COPY_DST |
      GPUBufferUsage.COPY_SRC,
  )

  // Packed rows {pageIndex,bin,selectionIndex,layer,triangles,raster}: nothing of the frame enters
  // there but the raster word, which the host sends as zero, and each half comes from its pass's
  // mask of the cut.
  // prettier-ignore
  const items = new Uint32Array([
    4, BIN_BACK, 0, 0, 1, RASTER_HARDWARE,
    1, BIN_NONE, 0, 0, 1, RASTER_HARDWARE,
    7, BIN_BACK, 0, 0, 1, RASTER_HARDWARE,
  ])
  const pass = { pass: device.createCommandEncoder().beginComputePass() }
  gpu.uploadItems(items, 0, 2)
  gpu.encode(pass, 3)
  const itemWrites = writes.filter(
    (write) => writtenBytes(write).byteLength === 3 * DRAW_ITEM_U32 * 4,
  ).length
  assert.equal(itemWrites, 1, 'the item rows are uploaded once')
  writes.length = 0
  gpu.encode(pass, 3)
  assert.equal(
    writes.some((write) => writtenBytes(write).byteLength === 3 * DRAW_ITEM_U32 * 4),
    false,
    'an unchanged drawable set re-uploads no item row',
  )
  // The camera draws two rows; the third, a light caster of the CPU cut, still travels.
  gpu.uploadItems(items, 0, 2)
  gpu.encode(pass, 2)
  assert.equal(
    writes.filter((write) => writtenBytes(write).byteLength === 3 * DRAW_ITEM_U32 * 4).length,
    1,
    'every rewritten row is uploaded, drawn or not',
  )
  gpu.encode(pass, 3)
  const indirect = buffers.find((buffer) => buffer.usage & GPUBufferUsage.INDIRECT)!
  const words = new Uint32Array(
    indirect.data.buffer,
    indirect.data.byteOffset,
    indirect.data.byteLength / 4,
  )
  assert.deepEqual([...words.subarray(0, 4)], [...packDrawIndirect(gpu.corners, 2)])
  assert.deepEqual([...words.subarray(4, 8)], [...packDrawIndirect(gpu.corners, 1)])
  for (let s = 0; s < BASE_SLOTS; s++) assert.equal(words[s * 4 + 3], 0)
  const instances = gpu.instanceBuffer as unknown as { data: Uint8Array }
  const ids = new Uint32Array(
    instances.data.buffer,
    instances.data.byteOffset,
    instances.data.byteLength / 4,
  )
  assert.deepEqual([...ids.subarray(0, 3)], [4, 7, 1])
  const offsets = gpu.groupsBuffer as unknown as { data: Uint8Array }
  assert.deepEqual(
    [...new Uint32Array(offsets.data.buffer).subarray(0, BASE_SLOTS)],
    [0, 2, ...Array<number>(BASE_SLOTS - 2).fill(3)],
  )
  gpu.dispose()
})
