// #1483: the GPU cut is the engine's one cut, and its rows a cache of what it draws and asks for.
// On the cut-rule DAG placed many times — the view sees one placement, packed last, past the rows
// the table opens with —, the shipped kernel cuts on Dawn, its readback feeds the row cache
// (`webgpu/row/slots.ts`), whose flags the next cut reads as residency: no CPU cut ever chooses.
// The loop settles on the cut the view wants, every wanted page drawn and nothing in its place,
// within a table smaller than the placements' instances; twice the placements ask the same rows.
import test from 'node:test'
import assert from 'node:assert/strict'
import { rowCacheScene, settleView } from './rowCacheScene.ts'

/** Rows the table holds: far fewer than the placements' instances, more than one view asks. */
const TABLE = 512

/** `copies` placements cut and followed until the drawn cut is the wanted one. */
async function settle(copies: number) {
  const scene = rowCacheScene(copies, TABLE)
  const { drawn, wanted } = await settleView(scene)
  return { rows: scene.rows, drawn, wanted, visible: scene.base(), instances: scene.instances }
}

test('the GPU cut reaches the cut the view wants through its row cache, past the table', async () => {
  const few = await settle(64),
    many = await settle(128)
  for (const { rows, drawn, wanted, visible, instances } of [few, many]) {
    assert.ok(instances > 8 * TABLE, `${instances} instances against ${TABLE} rows`)
    assert.ok(wanted.length > 4, 'the view wants a cut of several pages')
    assert.deepEqual(drawn, wanted, 'every wanted page drawn, no ancestor in its place')
    assert.ok(
      drawn.every((page) => page >= visible),
      'the visible placement alone',
    )
    assert.ok(rows.packedCount <= TABLE, 'the rows stay within the table')
    assert.equal(rows.rowsDenied, 0, 'no request the table could not serve')
    for (const page of wanted) assert.ok(rows.rowOfPage[page] >= 0, `${page} holds a row`)
  }
  // The view asks the same rows of twice the placements: its own pages, at its own ranks.
  const local = ({ drawn, visible }: typeof few) => drawn.map((page) => page - visible)
  assert.deepEqual(local(many), local(few))
})
