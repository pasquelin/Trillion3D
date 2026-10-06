// An explicitly requested `lit` view lights, even with no light: the contract runs and outputs
// black, emissives kept. A fallback on `store.count > 0` to raw albedo would display a room just
// switched off bright — the blackout would show on no pixel.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createSceneLightStore, type SceneLight } from '../../../../../sdk-core/src/index.ts'
import { directLightResources, readsAsIs, wantsContractLighting } from './lightResources.ts'
import type { WebgpuPagesRuntime } from '../runtime.ts'

const LAMP: SceneLight = {
  id: 'l0',
  kind: 'point',
  position: [0, 2, 0],
  color: [1, 1, 1],
  intensity: 5,
  range: 10,
  castsShadow: false,
}

function harness() {
  const store = createSceneLightStore()
  return { store, rt: { lights: { store } } as unknown as WebgpuPagesRuntime }
}

test('`lit` view with no light: the contract still lights, the image comes out black', () => {
  const b = harness()
  b.store.setView('lit')
  assert.equal(wantsContractLighting(b.rt), true)
})

test('turning off the last light in a `lit` view does not bring albedo back', () => {
  const b = harness()
  b.store.setView('lit')
  b.store.add({ ...LAMP })
  assert.equal(wantsContractLighting(b.rt), true)
  b.store.remove('l0')
  assert.equal(wantsContractLighting(b.rt), true, 'always lit, therefore black: that is the rule')
})

test('`auto` keeps its behaviour: albedo while no light is declared', () => {
  const b = harness()
  assert.equal(wantsContractLighting(b.rt), false, 'auto with no light: raw albedo')
  b.store.add({ ...LAMP })
  assert.equal(wantsContractLighting(b.rt), true, 'a declared light: real lighting takes over')
  b.store.remove('l0')
  assert.equal(
    wantsContractLighting(b.rt),
    false,
    'and it falls back to albedo when there are none left',
  )
})

test('`unlit` stays the diagnostic view, lights or not', () => {
  const b = harness()
  b.store.setView('unlit')
  assert.equal(wantsContractLighting(b.rt), false)
  b.store.add({ ...LAMP })
  assert.equal(wantsContractLighting(b.rt), false)
})

// The flagless variants are chosen only when nothing in the image can write the as-is flag.
test('the image reads its as-is flags once a row shows one, or under a diagnostic view', () => {
  const at = (asIsShown: boolean, diagnostic: string) =>
    readsAsIs({ vis: { asIsShown }, run: { diagnostic } } as unknown as WebgpuPagesRuntime)
  assert.equal(at(false, 'beauty'), false, 'no as-is surface: flagless')
  assert.equal(at(true, 'beauty'), true, 'a normal or depth surface took a row')
  assert.equal(at(false, 'wireframe'), true, 'a diagnostic view writes the flag')
})

test('the resolve with no shadow code is asked by the declared lights, never a slot', () => {
  const b = harness()
  // No visibility buffer yet: no receiver offset to recompute.
  const rt = { ...b.rt, bounce: {}, vis: {}, gpu: {} } as unknown as WebgpuPagesRuntime
  b.store.add({ ...LAMP })
  b.store.add({ ...LAMP, id: 'l1' })
  assert.equal(directLightResources(rt).unshadowed, true, 'no light declares a shadow')
  b.store.set('l1', { castsShadow: true })
  assert.equal(directLightResources(rt).unshadowed, true, 'a shadow, but no raster to draw it')
  Object.assign(rt.lights, { pageLayout: {} })
  assert.equal(directLightResources(rt).unshadowed, false, 'a declared shadow: shadow code')
  // A lamp that moves takes and leaves its slot: the program stays.
  for (const slice of [0, -1, 0]) {
    b.store.assignSlice(1, slice)
    assert.equal(directLightResources(rt).unshadowed, false)
  }
})

test('a frame with no rectangle light asks for the resolve with no rectangle code', () => {
  const b = harness()
  const rt = { ...b.rt, bounce: {}, vis: {}, gpu: {} } as unknown as WebgpuPagesRuntime
  b.store.add({ ...LAMP })
  assert.equal(directLightResources(rt).rectless, true, 'a point lamp alone')
  const panel: SceneLight = {
    ...LAMP,
    id: 'panel',
    kind: 'rect',
    direction: [0, -1, 0],
    right: [1, 0, 0],
    size: [2, 1],
  }
  b.store.add(panel)
  assert.equal(directLightResources(rt).rectless, false, 'a rectangle: the program that shades it')
  b.store.remove('panel')
  assert.equal(directLightResources(rt).rectless, true)
})

test('a frame asks for the shadow read of the kinds its shadowed lights are, never a slot (`ShadowKinds`)', () => {
  const b = harness()
  const rt = { ...b.rt, bounce: {}, vis: {}, gpu: {}, lights: { store: b.store, pageLayout: {} } }
  const key = () => {
    const { unshadowed, sunless, localless } = directLightResources(
      rt as unknown as WebgpuPagesRuntime,
    )
    return { unshadowed, sunless, localless }
  }
  const sun: SceneLight = {
    id: 'sun',
    kind: 'directional',
    color: [1, 1, 1],
    intensity: 5,
    direction: [0, -1, 0],
    castsShadow: false,
  }
  b.store.add({ ...LAMP })
  b.store.add({ ...sun })
  assert.deepEqual(
    key(),
    { unshadowed: true, sunless: false, localless: false },
    'no shadow: both cut at once',
  )
  b.store.set('sun', { castsShadow: true })
  assert.deepEqual(
    key(),
    { unshadowed: false, sunless: false, localless: true },
    'the sun alone casts',
  )
  b.store.set('l0', { castsShadow: true })
  assert.deepEqual(key(), { unshadowed: false, sunless: false, localless: false }, 'both kinds')
  b.store.set('sun', { castsShadow: false })
  assert.deepEqual(
    key(),
    { unshadowed: false, sunless: true, localless: false },
    'a lamp alone casts',
  )
  // A slot taken or left changes nothing.
  b.store.assignSlice(0, 0)
  assert.deepEqual(key(), { unshadowed: false, sunless: true, localless: false })
})
