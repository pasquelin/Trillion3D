import test from 'node:test'
import assert from 'node:assert/strict'
import { Mesh } from '../../../sdk-core/src/world/object/mesh.ts'
import { createWorldBatches } from '../world/core/worldBatches.ts'
import type { Cut } from '../world/core/worldCuts.ts'
import type { MaterialEntry } from '../world/core/worldMaterials.ts'

test('deformation row growth requests a structural reopen while stable owners retain their rows', () => {
  const batches = createWorldBatches(() => {})
  const cut = { key: 'morph', drawn: { deformation: { targets: [{}] } } } as unknown as Cut
  const material = { id: 1 } as MaterialEntry
  const first = new Mesh(),
    second = new Mesh()
  batches.seat(first, cut, material)
  const [batch] = batches.reopen()
  const rows = batch.rows
  assert.equal(rows!.sources![batches.seats.get(first)!.row], first)
  batches.seat(second, cut, material)
  let grown = false
  batches.growHeld(() => {}, {
    growsInPlace: () => true,
    growPlacements() {
      grown = true
    },
  })
  assert.equal(grown, false)
  assert.equal(batch.rows, rows)
  assert.equal(batches.waiting(), true)
  batches.reopen()
  assert.notEqual(batch.rows, rows)
  assert.equal(batch.rows!.sources![batches.seats.get(second)!.row], second)
})
