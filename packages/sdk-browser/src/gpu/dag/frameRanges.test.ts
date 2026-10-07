// A camera cut's `frames` past what one storage buffer binds: the host side of the split —
// ranges, buffers, bind groups, stages, writes, copies and dispatches. That the split cuts as the
// whole table is the GPU's to prove (`tests/gpu/dag/frame-ranges.gpu.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { framesBytes } from './frameRanges.ts'
import { storageBufferCap } from '../../residency/pools.ts'
import { createDagResources } from './resources.ts'
import { packDagSelection } from './selection.ts'
import { primitiveWordAt } from './worlds.ts'
import { encodeDagKernels } from './encode.ts'
import { witnessEncoder, cutResources } from './encode.fixture.ts'
import { dagFixture } from '../../page/selection/dag.fixture.ts'
import { packed } from './selectionHelpers.fixture.ts'
import { fakeDevice, written } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import { DAG_BINDING } from './shader/bindings.ts'
import { cameraFrameRanges } from './cameraRanges.ts'

test('the ranges cover every primitive once, each within one binding', () => {
  const limits = { maxBufferSize: 64 << 20, maxStorageBufferBindingSize: 128 << 20 }
  const ranges = cameraFrameRanges(limits, 1_000_000)
  assert.equal(ranges.length, Math.ceil(1_000_000 / Math.floor((64 << 20) / 384)))
  let next = 0
  for (const { first, count } of ranges) {
    assert.equal(first, next, 'no gap, no overlap')
    assert.ok(framesBytes(count) <= storageBufferCap(limits))
    next += count
  }
  assert.equal(next, 1_000_000)
  assert.deepEqual(cameraFrameRanges(limits, 100_000), [{ first: 0, count: 100_000 }])
})

/** Forty-eight placements of the fixture's primitive, on a device whose binding holds `per`. */
async function split(per: number) {
  const [root] = packed(dagFixture()).roots
  const dag = packDagSelection(Array.from({ length: 48 }, () => root))
  const limits = { maxBufferSize: 1 << 20, maxStorageBufferBindingSize: framesBytes(per) }
  const fake = fakeDevice({ limits: { ...limits, minUniformBufferOffsetAlignment: 256 } })
  const resources = await createDagResources(fake.device, dag)
  assert.ok(resources)
  return { fake, resources }
}

test('each range is its own buffer and bind group, and the stages know the split', async () => {
  const { fake, resources } = await split(20)
  const { frames, ranges } = resources
  const line = (values: ArrayLike<unknown>) => Array.from(values).join(' ')
  assert.equal(line(frames.ranges.map((r) => `${r.first}+${r.count}`)), '0+20 20+20 40+8')
  assert.equal(line(frames.buffers.map((b) => b.size)), line([20, 20, 8].map(framesBytes)))
  assert.equal(line(ranges.map((r) => r.count)), '20 20 8')
  let bounds: GPUBuffer | undefined
  for (const [r, { bindGroup }] of ranges.entries()) {
    const entries = Array.from((bindGroup as unknown as GPUBindGroupDescriptor).entries)
    const at = (binding: number) => entries.find((e) => e.binding === binding)!.resource
    assert.equal((at(DAG_BINDING.frames) as GPUBufferBinding).buffer, frames.buffers[r])
    assert.equal((at(DAG_BINDING.worlds) as GPUBufferBinding).buffer, frames.worldBuffers[r])
    assert.equal((at(DAG_BINDING.range) as GPUBufferBinding).offset, r * 256)
    bounds = (at(DAG_BINDING.range) as GPUBufferBinding).buffer
  }
  const words = fake.writes.find((w) => w.buffer === bounds)!
  assert.equal(line(Array.from(written(words)).filter((_, k) => k % 64 < 2)), '0 20 20 20 40 8')
  const constants = (cut: typeof resources | undefined) =>
    (cut?.preparePipeline as unknown as GPUProgrammableStage).constants
  assert.deepEqual(constants(resources), { SPLIT: 1 })
  const whole = await createDagResources(fakeDevice().device, resources.packed)
  assert.equal(whole?.ranges.length, 1)
  assert.equal(constants(whole), undefined, 'one range: the stages of before')
})

test("the host's rows and words land in their range, at their row there", async () => {
  const { fake, resources } = await split(20)
  const { frames, frameData } = resources
  // range:first row+rows, a host row being 28 floats.
  const at = (b: unknown) => frames.buffers.indexOf(b as GPUBuffer)
  const rows = fake.writes.filter((w) => at(w.buffer) >= 0)
  const row = (w: (typeof rows)[number]) => `${at(w.buffer)}:${w.dataOffset / 28}+${w.size! / 28}`
  assert.equal(rows.map(row).join(' '), '0:0+20 1:20+20 2:40+8')
  // The world matrices follow the same ranges, 64 bytes a primitive.
  const world = (w: (typeof rows)[number]) =>
    `${frames.worldBuffers.indexOf(w.buffer)}:${w.dataOffset / 64}+${w.size! / 64}`
  const worlds = fake.writes.filter((w) => frames.worldBuffers.includes(w.buffer))
  assert.equal(worlds.map(world).join(' '), '0:0+20 1:20+20 2:40+8')
  frames.writeWord(25, 1, 7)
  frames.flushWords()
  const word = fake.writes.at(-1)!
  assert.equal(word.buffer, frames.buffers[1])
  assert.equal(word.offset, (primitiveWordAt(5) + 1) * 4)
  assert.equal(new Uint32Array(frameData.buffer)[primitiveWordAt(25) + 1], 7)
})

test('each kernel that reads a primitive runs once per range, under its bind group', () => {
  const ranges = [100, 30].map((count, r) => ({ count, bindGroup: `r${r}` }))
  const { encoder, dispatches, boundGroups } = witnessEncoder()
  const cut = { ...cutResources(5), ranges } as unknown as Parameters<typeof encodeDagKernels>[1]
  encodeDagKernels(encoder as unknown as GPUCommandEncoder, cut)
  const of = (kernel: string) => dispatches.filter((l) => l.kernel === kernel).map((l) => l.groups)
  assert.deepEqual(of('dagPrepare'), [2, 1], 'the first range also resets 64 blocks')
  assert.deepEqual(of('dagRootLevel'), [2, 1], "each range's roots")
  assert.deepEqual(of('dagLevel1'), [1, 1, 1, 1], 'levels 1 and 4: each range walks the queue')
  assert.deepEqual(of('dagWanted'), ['indirect', 'indirect'])
  assert.deepEqual(of('dagMask'), ['indirect', 'indirect'])
  assert.deepEqual(of('dagSortRequests'), [1], 'a kernel that reads no primitive runs once')
  assert.ok(boundGroups.includes('r1'))
})
