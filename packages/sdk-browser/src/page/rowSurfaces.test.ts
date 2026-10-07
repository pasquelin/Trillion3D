// A frame asks whether a surface of its rows carries something (the lobes target's size): the
// answer is taken over the rows' surfaces once, and read where it was held while the rows and the
// table's age hold — a written row or an aged table takes it again.
import test from 'node:test'
import assert from 'node:assert/strict'
import { someRowSurface } from './rowSurfaces.ts'
import type { PageSurface } from './surface.ts'
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts'

test('a question over still rows is asked of their surfaces once, again once they move', () => {
  const plain = { clearcoat: 0 } as PageSurface,
    coated = { clearcoat: 0 } as PageSurface
  const rows = {
    packedRecs: [{ material: plain }, { material: plain }, { material: coated }],
    packedCount: 3,
    rowWrites: 0,
    tableEpoch: 0,
  } as unknown as WebgpuPagesRuntime['layout']['rows']
  let asked = 0
  const coatedRows = someRowSurface(
    (surface: PageSurface) => (asked++, (surface.clearcoat ?? 0) > 0),
  )
  assert.equal(coatedRows(rows), false)
  assert.equal(asked, 2, 'each distinct surface once')
  for (let frame = 0; frame < 5; frame++) coatedRows(rows)
  assert.equal(asked, 2, 'still rows: the held answer')
  // A material's new values age the table (`refreshWebgpuMaterials`): the answer is taken again.
  coated.clearcoat = 1
  rows.tableEpoch++
  assert.equal(coatedRows(rows), true)
  assert.equal(asked, 4)
  // A written row takes it again too.
  rows.packedCount = 2
  ;(rows as { rowWrites: number }).rowWrites++
  assert.equal(coatedRows(rows), false)
})
