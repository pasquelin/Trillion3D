// Triangle batches (`drawBatches`): the same triangles reach the raster in the same order as one
// instance per row did, so the visibility buffer is the same, ties included. `drawBatch` and
// `survives` run from the shipped WGSL, the vertex stage's corner bound (`corner>=page.indexCount`)
// is checked by its text, and so is `batchesOf`.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { functionsOf } from '../../materials/texture/shaderRule.fixture.ts'
import { VIS_SHADER } from '../shader/visWgsl.ts'
import { drawShader } from './shader.ts'
import { BASE_SLOTS, BATCH_SHIFT, HALF_SLOTS, drawBatches, slotCount } from './contract.ts'
import { lcgRandom } from '../../../../math/src/sequence/random.ts'

type Item = { row: number; bin: number; post: number; triangles: number }
type Shape = { corners: number; perRow: number }
type Prim = [row: number, triangle: number]

/** Transcribes WGSL `batchesOf`. */
const batchesOf = (item: Item, shape: Shape) =>
  Math.min(
    Math.max(Math.floor((item.triangles * 3 + shape.corners - 1) / shape.corners), 1),
    shape.perRow,
  )

test('batchesOf is the transcribed text', () => {
  assert.match(
    functionsOf(drawShader(1), ['batchesOf']),
    /clamp\(ceilDiv\(item\.triangles\*3u,uni\.corners\),1u,uni\.perRow\)/,
  )
  // The vertex stage idles every corner past its row's indices.
  assert.ok(functionsOf(VIS_SHADER, ['vis_vs']).includes(IDLE_CORNER))
  // `scatterGroups` writes a row's batches one after the other, each its first triangle on top.
  assert.match(drawShader(1), /instances\[at\+b\]=page\|\(\(b\*stride\)<<24u\)/)
})

/** What `countGroups`, `prefixGroups` and `scatterGroups` write: each slot's instance words in
 *  item order, an item's batches one after the other (the scatter's text is checked above). */
function compact(items: Item[], shape: Shape) {
  const slots = slotCount(1),
    lists: number[][] = Array.from({ length: slots }, () => [])
  for (let group = 0; group * 64 < items.length; group++)
    for (let s = 0; s < slots; s++)
      for (const item of items.slice(group * 64, group * 64 + 64))
        if (item.post * HALF_SLOTS + item.bin === s)
          for (let b = 0; b < batchesOf(item, shape); b++)
            lists[s].push(item.row | ((b * (shape.corners / 3)) << BATCH_SHIFT))
  return lists
}

type Stage = { drawBatch: (i: number) => [number, number] }
/** The vertex stage's bound on its corners: past its row's indices, a vertex draws nothing. */
const IDLE_CORNER = 'if(corner>=page.indexCount){out.position=vec4f(0.0,0.0,2.0,1.0);'
/** What the vertex stage of `instances` puts on screen, in draw order: one entry per triangle whose
 *  corners lie within its row's indices (`IDLE_CORNER`), each instance read with the shipped
 *  `drawBatch`. */
function primitives(instances: number[], corners: number, indexCount: (row: number) => number) {
  const uni = { indirect: 1, drawSlot: 0 }
  const { drawBatch } = shaderRun<Stage>(
    VIS_SHADER,
    ['drawBatch', 'instanceRow', 'instanceCorner'],
    { uni, instances: Uint32Array.from(instances), slotOffsets: new Uint32Array(1) },
  )
  const out: Prim[] = []
  let launched = 0
  for (let i = 0; i < instances.length; i++) {
    const [row, first] = drawBatch(i)
    for (let v = 0; v < corners; v++, launched++) {
      const corner = first + v
      if (corner % 3 === 0 && corner < indexCount(row)) out.push([row, corner / 3])
    }
  }
  return { out, launched }
}

function frame(seed: number, rows: number, maxTriangles: number): Item[] {
  const next = lcgRandom(seed)
  return Array.from({ length: rows }, (_, row) => ({
    row,
    bin: Math.floor(next() * HALF_SLOTS),
    post: next() < 0.3 ? 1 : 0,
    // Rows of every size, the widest page's among them, and empty rows.
    triangles: next() < 0.1 ? maxTriangles : Math.floor(next() * (maxTriangles + 1)),
  }))
}

for (const maxTriangles of [12, 32, 33, 128, 256])
  test(`batches draw the same triangles in the same order (widest page ${maxTriangles} triangles)`, () => {
    let before = 0,
      after = 0
    for (let seed = 1; seed <= 6; seed++) {
      const items = frame(seed * 7919 + maxTriangles, 64 * 3 + 17, maxTriangles)
      const indexCount = (row: number) => items[row].triangles * 3
      // The reference shape: one instance per row launching the widest page's corners.
      const single = { corners: maxTriangles * 3, perRow: 1 },
        batched = drawBatches(maxTriangles * 3)
      const a = compact(items, single),
        b = compact(items, batched)
      for (let s = 0; s < BASE_SLOTS; s++) {
        const was = primitives(a[s], single.corners, indexCount),
          now = primitives(b[s], batched.corners, indexCount)
        assert.deepEqual(now.out, was.out, `slot ${s}`)
        before += was.launched
        after += now.launched
      }
    }
    // An exact split never launches more; an inexact one at most a triangle more per batch.
    const { corners, perRow } = drawBatches(maxTriangles * 3)
    if (corners * perRow === maxTriangles * 3) assert.ok(after <= before)
    if (maxTriangles > 32) assert.ok(after < before, `${after} < ${before}`)
  })

test('the shape: a catalogue under a batch keeps its corners, a wider one launches batches', () => {
  assert.deepEqual(drawBatches(36), { corners: 36, perRow: 1 })
  assert.deepEqual(drawBatches(384), { corners: 96, perRow: 4 })
  assert.deepEqual(drawBatches(768), { corners: 96, perRow: 8 })
  assert.deepEqual(drawBatches(99), { corners: 51, perRow: 2 })
  assert.deepEqual(drawBatches(300), { corners: 75, perRow: 4 })
})
