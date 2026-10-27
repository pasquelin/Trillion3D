// Whether the lit passes hold the contact shadows' code, and what they read of the view: a light that casts
// a ray of its own asks for the code, and so does a surface of the eye or hair model whatever the view's
// switch says; the view's settings are folded into the lights; the camera hands over its forward axis.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../../scene/host/graph/graph.fixture.ts'
import { surfaceOf } from '../../geometry/pages/surface.ts'
import { createResidentSurfaces } from '../../geometry/clusters/surfaces.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import type { EngineCamera } from '../../camera/engineCamera.ts'
import { createSceneLightStore } from '../../../../sdk-core/src/scene/light/store.ts'
import { LIGHT_FIELD, baseOf } from '../../../../sdk-core/src/scene/light/fields.ts'
import type { SceneLight } from '../../../../sdk-core/src/scene/light/contracts.ts'
import { FULL_CONTRACT, cutsIn, keyOf, twinOf } from '../deferred/contractCuts.ts'
import { castsContactShadows, followContactShadows, setContactShadowView } from './frame.ts'

const LAMP: SceneLight = {
  id: 'lamp',
  kind: 'point',
  position: [0, 2, 0],
  color: [1, 1, 1],
  intensity: 5,
  range: 10,
  castsShadow: true,
}

/** A resident surface of this shading model, none for a plain one. */
const clustersOf = (shadingModel?: string) => {
  const surfaces = createResidentSurfaces()
  surfaces.set(0, surfaceOf(G.physicalSurface((shadingModel ? { shadingModel } : {}) as never)))
  return { surfaces }
}

const runtime = (context: object, store = createSceneLightStore(), model?: string) =>
  ({
    context,
    lights: { store },
    // The thin target holds the pixel models' data once a resident surface of a model asked for it.
    gpu: { surfaces: { hasSubsurface: !!model } },
    layout: { clusters: clustersOf(model) },
  }) as unknown as WebgpuPagesRuntime

const laneOf = (store: ReturnType<typeof createSceneLightStore>, id: string) =>
  store.packed[baseOf(store.slotOf(id)) + LIGHT_FIELD.contactGi]

test('no light casts a ray and no surface wears a model: no contact shadow code', () => {
  const store = createSceneLightStore()
  store.add({ ...LAMP })
  assert.equal(castsContactShadows(runtime({}, store)), false)
})

test('a frame with no surfaces yet has no pixel model: the lights alone decide', () => {
  const store = createSceneLightStore()
  const bare = { context: {}, lights: { store }, gpu: {} } as unknown as WebgpuPagesRuntime
  assert.equal(castsContactShadows(bare), false)
  store.add({ ...LAMP, contactShadowLength: 0.02 })
  assert.equal(castsContactShadows(bare), true)
})

test('a light that casts a ray of its own asks for the code', () => {
  const store = createSceneLightStore()
  store.add({ ...LAMP, contactShadowLength: 0.02 })
  assert.equal(castsContactShadows(runtime({}, store)), true)
})

test('the view’s settings are folded into the lights, and the code follows the folded lengths', () => {
  const store = createSceneLightStore()
  store.add({ ...LAMP, contactShadowLength: 0.02 })
  store.add({ ...LAMP, id: 'plain' })
  const fold = (context: object) => {
    followContactShadows(runtime(context, store))
    return castsContactShadows(runtime(context, store))
  }
  assert.equal(fold({ contactShadows: false }), false, 'the switch takes the lights’ rays away')
  assert.equal(laneOf(store, 'lamp'), 0)
  const metres = {
    contactShadowOverrideLength: 0.01,
    contactShadowOverrideLengthInWorldSpace: true,
  }
  assert.equal(fold(metres), true)
  assert.equal(laneOf(store, 'plain'), Math.fround(-0.01), 'in metres: negative, not doubled')
  assert.equal(fold({ contactShadowOverrideLength: 0.01 }), true)
  assert.equal(laneOf(store, 'plain'), Math.fround(0.02), 'in screen units: doubled')
  assert.equal(fold({ contactShadowOverrideLength: 0 }), false, 'an override of 0 casts none')
  assert.equal(fold({}), true, 'back to the lights’ own')
  assert.equal(laneOf(store, 'lamp'), Math.fround(0.04))
})

test('a surface of the eye or hair model asks for the code, with the switch off as on', () => {
  const store = createSceneLightStore()
  store.add({ ...LAMP })
  for (const model of ['eye', 'hair']) {
    assert.equal(castsContactShadows(runtime({}, store, model)), true, model)
    const off = runtime({ contactShadows: false }, store, model)
    assert.equal(castsContactShadows(off), true, model)
  }
  assert.equal(castsContactShadows(runtime({ contactShadows: false }, store)), false)
})

test('the camera hands over its forward axis, unit, and the tangent of half its field', () => {
  const written: unknown[][] = []
  const deferred = { setContactShadows: (...args: unknown[]) => void written.push(args) }
  // A camera whose third axis is +x looks along −x.
  const world = new Float64Array(16)
  world[8] = 2
  const projection = new Float64Array(16)
  projection[5] = 2
  const cam = { world, projection, perspective: 1 } as unknown as EngineCamera
  setContactShadowView(deferred as never, cam)
  assert.deepEqual([...(written[0][1] as number[])], [-1, -0, -0, 0.5])
  setContactShadowView(deferred as never, { ...cam, perspective: 0 } as EngineCamera)
  assert.equal((written[1][1] as number[])[3], 1, 'an orthographic camera’s tangent is 1')
})

test('a twin keeps the contact cut of its program, and the full contract holds the code', () => {
  assert.equal(FULL_CONTRACT.contactless, false)
  const contactless = cutsIn({ ...FULL_CONTRACT, contactless: true, rectless: true })
  assert.deepEqual(keyOf(false, twinOf(contactless)), { ...FULL_CONTRACT, contactless: true })
  assert.deepEqual(
    keyOf(false, twinOf(cutsIn({ ...FULL_CONTRACT, rectless: true }))),
    FULL_CONTRACT,
  )
})
