// The shared buffer (`wasmArena.ts`): a single allocation per batch, views that stay valid even
// when linear memory grows — whether that is the reservation itself or an allocation made
// elsewhere well after —, `list()` which re-reads a counter then its list, `blocsJavaScript()`
// which yields the same shape outside any module, and no allocation during a compute call.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { prepareSdkWasm, type SdkWasm } from './geometryPageWasm.ts'
import { blocsJavaScript, reserveArena, type ArenaRequest } from './wasmArena.ts'

const MODULE = readFileSync(join(import.meta.dirname, 'pageCodec.wasm'))

async function wasmFrais(): Promise<SdkWasm> {
  const module = (await import(`./geometryPageWasm.ts?fraicheur=${wasmFrais.counter++}`)) as {
    prepareSdkWasm: typeof prepareSdkWasm
  }
  const wasm = await module.prepareSdkWasm(MODULE)
  if (!wasm) throw new Error('the real module must instantiate')
  return wasm
}
wasmFrais.counter = 0

/** Counts calls to `arena_alloc` on the given module, without changing its behaviour. */
function allocationCount(wasm: SdkWasm) {
  const counter = { valeur: 0 }
  const espionne: SdkWasm = {
    ...wasm,
    arena_alloc: (bytes: number) => {
      counter.valeur++
      return wasm.arena_alloc(bytes)
    },
  }
  return { espionne, counter }
}

test('reserveArena makes only one allocation for all requested blocks', async () => {
  const wasm = await wasmFrais()
  const { espionne, counter } = allocationCount(wasm)
  const requests: ArenaRequest[] = [
    { type: 'u32', length: 1 },
    { type: 'f64', length: 6 },
    { type: 'f64', length: 32, pas: 16 },
  ]
  const arena = reserveArena(espionne, requests)
  assert.ok(arena)
  assert.equal(counter.valeur, 1)
  arena.freed()
})

test('views stay valid after the memory growth their own reservation caused', async () => {
  const wasm = await wasmFrais()
  // A large batch forces `arena_alloc` to grow linear memory, which detaches every `ArrayBuffer`
  // already built elsewhere. The views yielded here are built AFTER that allocation: they must
  // therefore point at the module's current buffer, not at a stale one.
  const arena = reserveArena(wasm, [{ type: 'f64', length: 200_000 }])
  assert.ok(arena)
  const [bloc] = arena.blocs()
  assert.equal(bloc.view.buffer, wasm.memory.buffer, 'the view must point at the current buffer')
  // Write and re-read of hostile values: the view is actually usable, not merely of the same
  // length.
  const view = bloc.view as Float64Array
  view[0] = -0
  view[1] = NaN
  view[view.length - 1] = Infinity
  assert.ok(Object.is(view[0], -0))
  assert.ok(Number.isNaN(view[1]))
  assert.equal(view[view.length - 1], Infinity)
  arena.freed()
})

test('views are rebuilt when a LATER allocation grows memory', async () => {
  const wasm = await wasmFrais()
  const arena = reserveArena(wasm, [{ type: 'f64', length: 4 }])
  assert.ok(arena)
  const valeurs = [-0, NaN, 1e308, 5e-324]
  ;(arena.blocs()[0].view as Float64Array).set(valeurs)
  const before = arena.blocs()[0].view,
    offsetBefore = arena.blocs()[0].offset
  assert.equal(arena.generation(), 0, 'nothing has grown memory yet')
  // An allocation that has nothing to do with this buffer — a page decode folded onto the main
  // thread does as much — replaces the module's `ArrayBuffer` and detaches the previous view.
  const gros = wasm.arena_alloc(64 * 1024 * 1024)
  assert.ok(gros, 'the large reservation must succeed')
  assert.equal(before.length, 0, 'the previous view must have been detached by the growth')
  const after = arena.blocs()[0]
  assert.equal(arena.generation(), 1, 'one rebuild, and only one')
  assert.equal(after.view.buffer, wasm.memory.buffer, 'the view must point at the current buffer')
  assert.equal(after.offset, offsetBefore, 'the block offset does not move')
  const relues = Array.from(after.view as Float64Array)
  for (let i = 0; i < valeurs.length; i++)
    assert.ok(Object.is(relues[i], valeurs[i]), `bloc[${i}] : ${relues[i]} ≠ ${valeurs[i]}`)
  assert.equal(arena.blocs()[0], after, 'without further growth, the blocks are not rebuilt')
  wasm.arena_free(gros, 64 * 1024 * 1024)
  arena.freed()
  assert.deepEqual(arena.blocs(), [], 'a released buffer no longer carries any view')
})

test('list() re-reads a counter written in one block then the list of another', async () => {
  const wasm = await wasmFrais()
  const arena = reserveArena(wasm, [
    { type: 'u32', length: 1 }, // the counter
    { type: 'f64', length: 8 }, // the list, at its maximum size
  ])
  assert.ok(arena)
  const [blockCounter, blockList] = arena.blocs()
  const valeurs = [1.5, -2.5, 3.5]
  for (let i = 0; i < valeurs.length; i++) (blockList.view as Float64Array)[i] = valeurs[i]
  ;(blockCounter.view as Uint32Array)[0] = valeurs.length
  const n = blockCounter.view[0]
  const lue = arena.list(1, n)
  assert.deepEqual(Array.from(lue), valeurs)
  arena.freed()
})

test('blocsJavaScript() yields the same shape as reserveArena() for the same requests', async () => {
  const wasm = await wasmFrais()
  const requests: ArenaRequest[] = [
    { type: 'u32', length: 4 },
    { type: 'f64', length: 32, pas: 16 },
    { type: 'f32', length: 9, pas: 3 },
  ]
  const arena = reserveArena(wasm, requests)
  assert.ok(arena)
  const outsideModule = blocsJavaScript(requests)
  assert.equal(outsideModule.length, arena.blocs().length)
  // Expected shapes, independent of both implementations: two subviews of 16 for the second
  // block, three of 3 for the third, none for the first.
  const expected = [{ views: undefined }, { views: [16, 16] }, { views: [3, 3, 3] }] as const
  const blocs = arena.blocs()
  for (let i = 0; i < requests.length; i++) {
    assert.equal(outsideModule[i].type, blocs[i].type)
    assert.equal(outsideModule[i].view.length, blocs[i].view.length)
    assert.equal(outsideModule[i].views?.length, blocs[i].views?.length)
    assert.equal(blocs[i].views?.map((v) => v.length).join(','), expected[i].views?.join(','))
    if (outsideModule[i].views)
      for (let v = 0; v < outsideModule[i].views!.length; v++)
        assert.equal(outsideModule[i].views![v].length, blocs[i].views![v].length)
  }
  arena.freed()
})

test('a compute call allocates nothing: math_box_transform_batch works in the reserved buffer', async () => {
  const wasm = await wasmFrais()
  const arena = reserveArena(wasm, [
    { type: 'f64', length: 6 },
    { type: 'f64', length: 16 },
    { type: 'f64', length: 6 },
  ])
  assert.ok(arena)
  const [boxes, mats, out] = arena.blocs()
  ;(boxes.view as Float64Array).set([-1, -1, -1, 1, 1, 1])
  ;(mats.view as Float64Array).set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
  const { espionne, counter } = allocationCount(wasm)
  counter.valeur = 0
  espionne.math_box_transform_batch(out.offset, boxes.offset, mats.offset, 1)
  assert.equal(counter.valeur, 0, 'the computation must cause no allocation')
  assert.deepEqual(Array.from(out.view as Float64Array), [-1, -1, -1, 1, 1, 1])
  arena.freed()
})
