// The shared buffer (`wasmArena.ts`): a single allocation per batch, views that stay valid even
// when linear memory grows — whether that is the reservation itself or an allocation made
// elsewhere well after —, `list()` which re-reads a counter then its list, `javaScriptBlocks()`
// which yields the same shape outside any module, and no allocation during a compute call.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { prepareSdkWasm, type SdkWasm } from './sdkWasm.ts'
import { javaScriptBlocks, reserveArena, type ArenaRequest } from './wasmArena.ts'

const MODULE = readFileSync(join(import.meta.dirname, 'kernels.wasm'))

async function freshWasm(): Promise<SdkWasm> {
  const module = (await import(`./sdkWasm.ts?fresh=${freshWasm.counter++}`)) as {
    prepareSdkWasm: typeof prepareSdkWasm
  }
  const wasm = await module.prepareSdkWasm(MODULE)
  if (!wasm) throw new Error('the real module must instantiate')
  return wasm
}
freshWasm.counter = 0

/** Counts calls to `arena_alloc` on the given module, without changing its behaviour. */
function allocationCount(wasm: SdkWasm) {
  const counter = { value: 0 }
  const spy: SdkWasm = {
    ...wasm,
    arena_alloc: (bytes: number) => {
      counter.value++
      return wasm.arena_alloc(bytes)
    },
  }
  return { spy, counter }
}

test('reserveArena makes only one allocation for all requested blocks', async () => {
  const wasm = await freshWasm()
  const { spy, counter } = allocationCount(wasm)
  const requests: ArenaRequest[] = [
    { type: 'u32', length: 1 },
    { type: 'f64', length: 6 },
    { type: 'f64', length: 32, stride: 16 },
  ]
  const arena = reserveArena(spy, requests)
  assert.ok(arena)
  assert.equal(counter.value, 1)
  arena.freed()
})

test('views stay valid after the memory growth their own reservation caused', async () => {
  const wasm = await freshWasm()
  // A large batch forces `arena_alloc` to grow linear memory, which detaches every `ArrayBuffer`
  // already built elsewhere. The views yielded here are built AFTER that allocation: they must
  // therefore point at the module's current buffer, not at a stale one.
  const arena = reserveArena(wasm, [{ type: 'f64', length: 200_000 }])
  assert.ok(arena)
  const [block] = arena.blocks()
  assert.equal(block.view.buffer, wasm.memory.buffer, 'the view must point at the current buffer')
  // Write and re-read of hostile values: the view is actually usable, not merely of the same
  // length.
  const view = block.view as Float64Array
  view[0] = -0
  view[1] = NaN
  view[view.length - 1] = Infinity
  assert.ok(Object.is(view[0], -0))
  assert.ok(Number.isNaN(view[1]))
  assert.equal(view[view.length - 1], Infinity)
  arena.freed()
})

test('views are rebuilt when a LATER allocation grows memory', async () => {
  const wasm = await freshWasm()
  const arena = reserveArena(wasm, [{ type: 'f64', length: 4 }])
  assert.ok(arena)
  const values = [-0, NaN, 1e308, 5e-324]
  ;(arena.blocks()[0].view as Float64Array).set(values)
  const before = arena.blocks()[0].view,
    offsetBefore = arena.blocks()[0].offset
  assert.equal(arena.generation(), 0, 'nothing has grown memory yet')
  // An allocation that has nothing to do with this buffer — another kernel's, on the same
  // module — replaces the module's `ArrayBuffer` and detaches the previous view.
  const large = wasm.arena_alloc(64 * 1024 * 1024)
  assert.ok(large, 'the large reservation must succeed')
  assert.equal(before.length, 0, 'the previous view must have been detached by the growth')
  const after = arena.blocks()[0]
  assert.equal(arena.generation(), 1, 'one rebuild, and only one')
  assert.equal(after.view.buffer, wasm.memory.buffer, 'the view must point at the current buffer')
  assert.equal(after.offset, offsetBefore, 'the block offset does not move')
  const reread = Array.from(after.view as Float64Array)
  for (let i = 0; i < values.length; i++)
    assert.ok(Object.is(reread[i], values[i]), `block[${i}]: ${reread[i]} ≠ ${values[i]}`)
  assert.equal(arena.blocks()[0], after, 'without further growth, the blocks are not rebuilt')
  wasm.arena_free(large, 64 * 1024 * 1024)
  arena.freed()
  assert.deepEqual(arena.blocks(), [], 'a released buffer no longer carries any view')
})

test('list() re-reads a counter written in one block then the list of another', async () => {
  const wasm = await freshWasm()
  const arena = reserveArena(wasm, [
    { type: 'u32', length: 1 }, // the counter
    { type: 'f64', length: 8 }, // the list, at its maximum size
  ])
  assert.ok(arena)
  const [blockCounter, blockList] = arena.blocks()
  const values = [1.5, -2.5, 3.5]
  for (let i = 0; i < values.length; i++) (blockList.view as Float64Array)[i] = values[i]
  ;(blockCounter.view as Uint32Array)[0] = values.length
  const n = blockCounter.view[0]
  const read = arena.list(1, n)
  assert.deepEqual(Array.from(read), values)
  arena.freed()
})

test('javaScriptBlocks() yields the same shape as reserveArena() for the same requests', async () => {
  const wasm = await freshWasm()
  const requests: ArenaRequest[] = [
    { type: 'u32', length: 4 },
    { type: 'f64', length: 32, stride: 16 },
    { type: 'f32', length: 9, stride: 3 },
  ]
  const arena = reserveArena(wasm, requests)
  assert.ok(arena)
  const outsideModule = javaScriptBlocks(requests)
  assert.equal(outsideModule.length, arena.blocks().length)
  // Expected shapes, independent of both implementations: two subviews of 16 for the second
  // block, three of 3 for the third, none for the first.
  const expected = [{ views: undefined }, { views: [16, 16] }, { views: [3, 3, 3] }] as const
  const blocks = arena.blocks()
  for (let i = 0; i < requests.length; i++) {
    assert.equal(outsideModule[i].type, blocks[i].type)
    assert.equal(outsideModule[i].view.length, blocks[i].view.length)
    assert.equal(outsideModule[i].views?.length, blocks[i].views?.length)
    assert.equal(blocks[i].views?.map((v) => v.length).join(','), expected[i].views?.join(','))
    if (outsideModule[i].views)
      for (let v = 0; v < outsideModule[i].views!.length; v++)
        assert.equal(outsideModule[i].views![v].length, blocks[i].views![v].length)
  }
  arena.freed()
})

test('a compute call allocates nothing: math_box_transform_batch works in the reserved buffer', async () => {
  const wasm = await freshWasm()
  const arena = reserveArena(wasm, [
    { type: 'f64', length: 6 },
    { type: 'f64', length: 16 },
    { type: 'f64', length: 6 },
  ])
  assert.ok(arena)
  const [boxes, mats, out] = arena.blocks()
  ;(boxes.view as Float64Array).set([-1, -1, -1, 1, 1, 1])
  ;(mats.view as Float64Array).set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
  const { spy, counter } = allocationCount(wasm)
  counter.value = 0
  spy.math_box_transform_batch(out.offset, boxes.offset, mats.offset, 1)
  assert.equal(counter.value, 0, 'the computation must cause no allocation')
  assert.deepEqual(Array.from(out.view as Float64Array), [-1, -1, -1, 1, 1, 1])
  arena.freed()
})
