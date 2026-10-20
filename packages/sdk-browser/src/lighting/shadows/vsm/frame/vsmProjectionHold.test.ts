// The projection runs again only when one of its inputs changed (`vsmProjectionHold.ts`): the view,
// the projection with its jitter, any of the three revisions, the lights' epoch or channels, the
// shadow pages' version, the stochastic phase, the targets' size or the mask itself.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createVsmProjectionHold } from './vsmProjectionHold.ts'

const IDENTITY = Float64Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
const mask = {}

function frame(change: (inputs: ReturnType<typeof createVsmProjectionHold>['inputs']) => void) {
  const hold = createVsmProjectionHold()
  const set = (edit?: typeof change) => {
    const { inputs } = hold
    inputs.view = IDENTITY
    inputs.projection = IDENTITY
    inputs.revisions = { view: 1, scene: 2, resources: 3 }
    inputs.lightsEpoch = 4
    inputs.shadowEpoch = 5
    inputs.phase = 6
    inputs.size = [64, 32]
    inputs.lights = [{ mapId: 7 }, { mapId: 71 }]
    edit?.(inputs)
  }
  set()
  assert.equal(hold.held(mask), false, 'nothing projected yet')
  hold.keep(mask)
  set()
  assert.equal(hold.held(mask), true, 'the same inputs')
  set(change)
  return hold.held(mask)
}

test('a frame with the last projection’s inputs holds its mask', () => {
  assert.equal(
    frame(() => {}),
    true,
  )
})

test('any input that changed runs the projection again', () => {
  const moved = Float64Array.from(IDENTITY)
  moved[12] = 1e-12
  const changes: Record<string, Parameters<typeof frame>[0]> = {
    view: (i) => (i.view = moved),
    projection: (i) => (i.projection = moved),
    'view revision': (i) => (i.revisions = { view: 2, scene: 2, resources: 3 }),
    'scene revision': (i) => (i.revisions = { view: 1, scene: 3, resources: 3 }),
    'resources revision': (i) => (i.revisions = { view: 1, scene: 2, resources: 4 }),
    'lights epoch': (i) => (i.lightsEpoch = 5),
    'shadow pages': (i) => (i.shadowEpoch = 6),
    'stochastic phase': (i) => (i.phase = 7),
    'target size': (i) => (i.size = [64, 33]),
    'a light’s channel': (i) => (i.lights = [{ mapId: 7 }, { mapId: 72 }]),
    'a light fewer': (i) => (i.lights = [{ mapId: 7 }]),
  }
  for (const [name, change] of Object.entries(changes)) assert.equal(frame(change), false, name)
})

test('another mask is projected into', () => {
  const hold = createVsmProjectionHold()
  hold.inputs.lights = []
  assert.equal(hold.held(mask), false)
  hold.keep(mask)
  assert.equal(hold.held(mask), true)
  assert.equal(hold.held({}), false)
})
