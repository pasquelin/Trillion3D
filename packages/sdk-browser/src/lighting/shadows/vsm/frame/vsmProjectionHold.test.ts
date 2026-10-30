// The projection runs again only when one of its inputs changed (`vsmProjectionHold.ts`): the view,
// the projection with its jitter, any of the three revisions, the lights' epoch or channels, the
// shadow pages' version, the stochastic phase, the rays and steps of the traces, the targets' size or the mask itself.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createVsmProjectionHold, vsmTraceKey } from './vsmProjectionHold.ts'
import { SHADOW_RAY_COUNT_MAX } from '../../../../../../sdk-core/src/contracts/shadowMapOptions.ts'

const IDENTITY = Float64Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
const mask = {}
const EIGHT_BY_FOUR = {
  ...{ shadowRayCountDirectional: 8, shadowRayCountLocal: 8 },
  ...{ shadowSamplesPerRayDirectional: 4, shadowSamplesPerRayLocal: 4 },
}

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
    inputs.trace = 8
    inputs.size = [64, 32]
    inputs.lights = [{ mapId: 7 }, { mapId: 71 }]
    edit?.(inputs)
  }
  set()
  assert.equal(hold.held(mask), false, 'nothing projected yet')
  hold.keep()
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
    'rays and steps': (i) => (i.trace = vsmTraceKey({ ...EIGHT_BY_FOUR, shadowRayCountLocal: 4 })),
    'target size': (i) => (i.size = [64, 33]),
    'a light’s channel': (i) => (i.lights = [{ mapId: 7 }, { mapId: 72 }]),
    'a light fewer': (i) => (i.lights = [{ mapId: 7 }]),
    'the fields’ generation': (i) => (i.field.generation = 1),
    'the fields’ revision': (i) => (i.field.revision = 1),
    'the field shadow switch': (i) => (i.field.shadowing = !i.field.shadowing),
    'the field shadow quality': (i) => (i.field.quality = 2),
    'the field shadow resolution': (i) => (i.field.fullResolution = !i.field.fullResolution),
    'the field distance scale': (i) => (i.field.distanceScale = 2),
    'the field far transition': (i) => (i.field.farTransitionScale = 0.5),
    'the key of the shadows laid into the masks': (i) => (i.contributors = 2),
    'the passes of the masks’ denoise': (i) => (i.denoise = 2),
  }
  for (const [name, change] of Object.entries(changes)) assert.equal(frame(change), false, name)
})

test('another mask is projected into', () => {
  const hold = createVsmProjectionHold()
  hold.inputs.lights = []
  assert.equal(hold.held(mask), false)
  hold.keep()
  assert.equal(hold.held(mask), true)
  assert.equal(hold.held({}), false)
})

test('every pair of rays and steps the settings take has a key of its own', () => {
  const keys = new Set<number>()
  const rays = [0, 1, 7, 8, SHADOW_RAY_COUNT_MAX - 1, SHADOW_RAY_COUNT_MAX],
    steps = [0, 1, 4, 63, 64]
  for (const rd of rays)
    for (const rl of rays)
      for (const sd of steps)
        for (const sl of steps) {
          const counts = {
            ...{ shadowRayCountDirectional: rd, shadowRayCountLocal: rl },
            ...{ shadowSamplesPerRayDirectional: sd, shadowSamplesPerRayLocal: sl },
          }
          keys.add(vsmTraceKey(counts))
        }
  assert.equal(keys.size, rays.length ** 2 * steps.length ** 2)
})
