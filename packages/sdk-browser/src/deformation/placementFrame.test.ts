// A loaded model placed again grows its meshes' rows (`WorldModels.place`); every row, the first
// one too, still reads its skeleton in the model's graph, never in the world its row stands in
// (`PlacementRows.local`). A grown buffer that lost it skinned each placement against its own
// world: every walker of a ring drawn at the origin, whatever its placement.
import test from 'node:test'
import assert from 'node:assert/strict'
import { placeModel } from '../session/world/models/loadedModel.ts'
import { createWorldModels } from '../session/world/models/models.ts'
import { createWorldRanks } from '../session/world/ranks.ts'
import { loadedModel, meshLinks } from '../session/world/models/models.fixture.ts'
import { placementDeformation } from './placementSource.ts'

test('every row of a model placed again reads its bones in the graph, not in its placement', () => {
  const { loaded, drawn } = loadedModel(meshLinks(1))
  const models = createWorldModels(createWorldRanks())
  const again = placeModel(loaded)
  models.place(loaded)
  models.place(again)
  const { rows } = models.drawsOf(again).rowed[0]
  assert.equal(rows.capacity >= 2, true, 'the rows grew for the second placement')
  for (const index of [0, 1]) {
    const { mesh } = placementDeformation({ placement: { rows, index } }, {}, new Map())
    assert.equal(mesh.frame, drawn[0].matrixWorld.elements, `row ${index}`)
  }
})
