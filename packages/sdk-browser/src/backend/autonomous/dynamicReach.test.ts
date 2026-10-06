// #573 on the WebGL2 path: a dynamic geometry's pages are bounded by their own corners at rest,
// and its roots hold the reach each rewrite hands them, the farthest a vertex lies now
// (`createDynamicReach`): the CPU cut, its bounds grown by that reach, keeps a page its rewrite
// carried into the view from outside it.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../../host/graph/graph.fixture.ts'
import { object } from '../../../../sdk-core/src/world/object/index.ts'
import { geometry } from '../../../../sdk-core/src/world/geometry/index.ts'
import { material } from '../../../../sdk-core/src/world/material/index.ts'
import { selectVisiblePages } from '../../page/selection/selection.ts'
import { createEngineCamera, readCameraWorld } from '../../camera/world.ts'
import { createHeldResidency } from '../../page/cut/held.ts'
import {
  collectedPages,
  cornersWithin,
  dynamicWorld,
} from '../../world/core/worldDynamic.fixture.ts'
import { createDynamicReach } from './dynamicReach.ts'

/** A 4 × 4 sheet lying at z = 0, then lifted by `lift`: the roots and records the path collects. */
async function liftedSheet(lift: number) {
  const world = dynamicWorld()
  const sheet = geometry.plane(4, 4, 30, 30)
  sheet.usage = 'dynamic'
  world.scene.add(object.mesh(sheet, material.meshStandard({})))
  await world.frame()
  const collected = await collectedPages(world.sources[0])
  const position = sheet.attributes.position
  for (let v = 0; v < position.count; v++) position.setZ(v, lift)
  position.needsUpdate = true
  await world.frame()
  world.end()
  return {
    ...collected,
    attributes: collected.records[0].attributes,
    reach: world.reaches.at(-1)!,
  }
}

/** The pages the CPU cut shows to an eye at z = 1.5 looking along +x through a narrow view: the
 *  lifted sheet, never the sheet at rest 1.5 below its line of sight. */
function shown(roots: Awaited<ReturnType<typeof liftedSheet>>['roots']) {
  const cam = G.perspectiveCamera(10, 1, 0.1, 100)
  cam.position.set(-4, 0, 1.5)
  cam.lookAt(10, 0, 1.5)
  cam.updateMatrixWorld()
  const ask = {
    pixelError: 0,
    viewport: [512, 512] as [number, number],
    held: createHeldResidency(),
  }
  return selectVisiblePages(roots, readCameraWorld(createEngineCamera(), cam), ask).shown.length
}

test('the CPU cut keeps every page a rewrite carried into the view, by the reach its roots hold', async () => {
  const { roots, records, attributes, reach } = await liftedSheet(1.5)
  assert.equal(reach, 1.5, 'the sheet lifted by a metre and a half')
  for (const rec of records)
    assert.ok(cornersWithin(rec, rec.attributes.position.array, reach), 'within box and reach')
  assert.equal(shown(roots), 0, 'bounded at rest, the lifted sheet would be culled')
  const held = createDynamicReach(roots, () => 0)
  held.note(attributes, reach)
  for (const root of roots) assert.equal(root.reach, reach)
  assert.ok(shown(roots) > 0, 'its roots holding the reach, the cut keeps it')
})

test("a reach is the rewrite's own, and a root listed after its geometry moved takes it at the next note", async () => {
  const { roots, attributes } = await liftedSheet(0.5)
  let revision = 0
  const own = [roots[0]],
    late = { ...roots[0], reach: undefined },
    held = createDynamicReach(own, () => revision)
  held.note(attributes, 0.5)
  held.note(attributes, 0.25)
  assert.equal(own[0].reach, 0.25, 'the vertices came back: the bounds with them')
  own.push(late)
  held.note(attributes, 0.25)
  assert.equal(late.reach, undefined, 'the roots of one revision are listed once')
  revision++
  held.note(attributes, 0.25)
  assert.equal(late.reach, 0.25, 'a new revision lists the roots again')
})
