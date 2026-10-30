// The feed of the translucent object shadows: bounds in centimetres, the view test, the light records.
import test from 'node:test'
import assert from 'node:assert/strict'
import { Object3D } from '../../../../../sdk-core/src/world/object/object3d.ts'
import {
  casterBounds,
  objectShadowLightRecord,
  objectShadowViewOf,
  translucentCastersOf,
  type TranslucentCaster,
} from './objectShadowFeed.ts'

const identity = () => {
  const e = new Float64Array(16)
  e[0] = e[5] = e[10] = e[15] = 1
  return e
}
const camera = (x = 0) => {
  const world = identity()
  world[12] = x
  const projection = new Float64Array(16)
  projection[0] = 1
  projection[5] = 1
  return { world, projection }
}

test('a caster is bounded in centimetres by its local box under its world', () => {
  const world = identity()
  world[12] = 2
  const caster = {
    rank: 0,
    node: { matrixWorld: { elements: world } },
    localBox: [-1, -1, -1, 1, 1, 1],
  } as unknown as TranslucentCaster
  const bounds = casterBounds(caster, { origin: [0, 0, 0], extent: [0, 0, 0], radius: 0 })
  assert.deepEqual([...bounds.origin], [200, 0, 0])
  assert.deepEqual([...bounds.extent], [100, 100, 100])
  assert.ok(Math.abs(bounds.radius - 100 * Math.sqrt(3)) < 1e-9)
})

test('the view is sized from the projection and the viewport, in centimetres', () => {
  const view = objectShadowViewOf(camera(3), [800, 600])
  assert.deepEqual(Array.from(view.origin), [300, 0, 0])
  assert.equal(view.screenScale, 400)
})

test('a light record carries its range in centimetres and lets translucent surfaces cast unless it says not', () => {
  const light = {
    id: 'a',
    kind: 'point',
    position: [1, 2, 3],
    range: 4,
    color: [1, 1, 1],
    castsShadow: true,
  } as never
  const record = objectShadowLightRecord(light, 7)
  assert.equal(record.id, 7)
  assert.equal(record.castTranslucentShadows, true)
  assert.deepEqual(record.light, { kind: 'local', position: [100, 200, 300], radius: 400 })
  assert.equal(
    objectShadowLightRecord({ ...(light as object), castTranslucentShadows: false } as never, 1)
      .castTranslucentShadows,
    false,
  )
})

test('the casters follow the nodes’ shadow flags and the blend items’ list', () => {
  const node = new Object3D()
  node.castShadow = true
  node.castVolumetricTranslucentShadow = true
  const roots = [{ localBox: [-1, -1, -1, 1, 1, 1], pages: [{ drawSource: { node } }] }]
  const blendState = { blendGpu: [] as unknown[] }
  const rt = { layout: { selectionRoots: roots }, blendState } as never
  const first = translucentCastersOf(rt)
  assert.equal(first.length, 1)
  assert.equal(translucentCastersOf(rt), first, 'the same list while nothing moved')
  node.castsShadowMaps = false
  assert.equal(translucentCastersOf(rt).length, 0, 'a node out of the shadow maps casts none')
  node.castsShadowMaps = true
  const again = translucentCastersOf(rt)
  assert.equal(again.length, 1)
  assert.equal(translucentCastersOf(rt), again)
  node.castShadow = false
  assert.equal(translucentCastersOf(rt).length, 0)
  node.castShadow = true
  assert.equal(translucentCastersOf(rt).length, 1)
  // A list of blend items made again (the scene's blends were mounted again) is read again, at an equal count.
  const held = translucentCastersOf(rt)
  blendState.blendGpu = []
  assert.notEqual(translucentCastersOf(rt), held)
  assert.equal(translucentCastersOf(rt).length, 1)
})
