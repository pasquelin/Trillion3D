// A frame asks whether a surface its clusters wear carries something (the lobes target's size): the
// answer is taken over the resident clusters' surfaces once, and read where it was held while their
// list and the records' age hold — a surface that came or went, or an aged table, takes it again.
import test from 'node:test'
import assert from 'node:assert/strict'
import { someRowSurface } from './rowSurfaces.ts'
import type { PageSurface } from './surface.ts'
import { createResidentSurfaces } from '../clusters/surfaces.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'

test('a question over still clusters is asked of their surfaces once, again once they move', () => {
  const plain = { clearcoat: 0 } as PageSurface,
    coated = { clearcoat: 0 } as PageSurface
  const surfaces = createResidentSurfaces()
  surfaces.set(0, plain)
  surfaces.set(1, plain)
  surfaces.set(2, coated)
  const clusters = { surfaces, infoEpoch: 1 } as unknown as WebgpuPagesRuntime['layout']['clusters']
  let asked = 0
  const coatedClusters = someRowSurface(
    (surface: PageSurface) => (asked++, (surface.clearcoat ?? 0) > 0),
  )
  assert.equal(coatedClusters(clusters), false)
  assert.equal(asked, 2, 'each distinct surface once')
  for (let frame = 0; frame < 5; frame++) coatedClusters(clusters)
  assert.equal(asked, 2, 'still clusters: the held answer')
  // A material's new values age the records (`materialTable.follow`): the answer is taken again.
  coated.clearcoat = 1
  clusters.infoEpoch++
  assert.equal(coatedClusters(clusters), true)
  assert.equal(asked, 4)
  // A surface that goes takes it again too.
  surfaces.drop(2)
  assert.equal(coatedClusters(clusters), false)
})
