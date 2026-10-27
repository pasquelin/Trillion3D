// The frame plan reads the light store: a light that casts no shadow is asked for neither the local
// gate nor the sun's cascades — a thousand lamps that cast nothing cost a thousand reads, no more.
import test from 'node:test'
import assert from 'node:assert/strict'
import type { SceneLight } from '../../../../../../sdk-core/src/scene/light/contracts.ts'
import { perspectiveProjection } from '../../../../../../math/src/projection/camera.ts'
import type { WebgpuPagesRuntime } from '../../../../frame/backend/runtime.ts'
import { frameLights } from './vsmPlan.ts'

const view = new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
const projection = perspectiveProjection(new Float64Array(16), 90, 1, 0.1, 1)
const cam = { view, projection, eye: [0, 0, 0], near: 0.1, viewTarget: new Float64Array(3) }

/** The properties read of each light of a store, by its id (its id itself aside, the store's key). */
const reads = new Map<string, string[]>()
const watched = (light: SceneLight) =>
  new Proxy(light, {
    get(target, key, receiver) {
      if (key !== 'id') reads.get(target.id)!.push(String(key))
      return Reflect.get(target, key, receiver)
    },
  })

function runtimeOf(lights: SceneLight[]) {
  reads.clear()
  const held = lights.map((light) => (reads.set(light.id, []), watched(light)))
  return {
    lights: {
      mobility: { worldSpace: 0 },
      store: {
        count: held.length,
        ids: lights.map((l) => l.id),
        light: (id: string) => held.find((l) => l.id === id),
      },
    },
    gpu: { targetSize: [1000, 1000] },
    context: {},
    run: { frame: 0 },
  } as unknown as WebgpuPagesRuntime
}

const lamp = (id: string, castsShadow: boolean): SceneLight => ({
  ...{ id, kind: 'point', position: [0, 0, -10], range: 5 },
  ...{ color: [1, 1, 1], intensity: 1, castsShadow },
})
const sun = (id: string, castsShadow: boolean): SceneLight => ({
  ...{ id, kind: 'directional', direction: [0, -1, 0], color: [1, 1, 1], intensity: 1 },
  castsShadow,
})

test('a light that casts no shadow is asked for neither its gate nor its cascades, one that casts is', () => {
  const rt = runtimeOf([
    lamp('quiet', false),
    sun('moon', false),
    lamp('loud', true),
    sun('day', true),
  ])
  const list = frameLights(rt, 'plan', cam as never)
  assert.deepEqual(
    list.map((entry) => [entry.light.id, entry.visible]),
    [
      ['quiet', false],
      ['moon', false],
      ['loud', true],
      ['day', true],
    ],
  )
  // Nothing of a quiet light is read but the flag; a loud one is measured and a loud sun is cut.
  assert.deepEqual(reads.get('quiet'), ['castsShadow'])
  assert.deepEqual(reads.get('moon'), ['castsShadow'])
  assert.ok(reads.get('loud')!.includes('position'), 'the gate measured it')
  assert.ok(list[3].cascades, 'the sun that casts has its cascades')
  assert.equal(list[1].cascades, undefined, 'the sun that casts none has none')
  // The reserve sizes the set alone: it takes no cascades.
  assert.equal(frameLights(runtimeOf([sun('day', true)]), 'reserve')[0].cascades, undefined)
})
