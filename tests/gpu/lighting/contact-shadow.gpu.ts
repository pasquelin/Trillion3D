// The contact shadows' ray run on a real GPU (`contactShadowPage.ts`): the shipped block reads a depth
// image, the flags of its pixels and the engine's light record, and answers, for a probe on a floor,
// the share of the light that gets past a platform beside it. The cases are the ones the reference's
// rules fix: the length of a light that casts a shadow, in metres or in screen units (doubled);
// nothing for a light that casts none or names no length; the casting and non-casting intensities,
// by the surface hit (an eye's casts none); the view's overrides and switch, folded into the lights;
// the eye's ray of half a centimetre and the hair's of a fifth of the screen's half height under a
// light with no dynamic shadow, whatever the switch says; and the light a subsurface model lets
// through by the density of its opacity.
//
//   node bench/dawn/proofs.ts tests/gpu/lighting/contact-shadow.gpu.ts
import test, { before } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { loadPage, runOnDawn } from '../../kit/device/onDawn.ts'
import { PIXEL_MODEL } from '../../../packages/sdk-browser/src/materials/surface/pixelModel.ts'
import type { ContactCase } from './contactShadowPage.ts'

/** A light that casts a shadow and names a ray of a metre, 30 degrees over a platform 0.3 m high that
 *  starts 0.25 m ahead of the probe: the ray passes under its top and the platform is hit. */
const WALL: ContactCase = {
  name: 'wall',
  light: { castsShadow: true, length: 1, world: true },
  elevation: 30,
  x: -0.25,
  platform: 0.3,
}

/** An eye pixel under a light that casts no shadow: its ray of half a centimetre meets a platform a
 *  millimetre high, the light 10 degrees over the floor. */
const EYE: ContactCase = {
  name: 'eye',
  light: { castsShadow: false, length: 0 },
  elevation: 10,
  x: -0.002,
  platform: 0.001,
  model: PIXEL_MODEL.eye,
}

/** A hair pixel under a light with no dynamic shadow: a ray of a fifth of the screen meets a platform
 *  5 cm high. */
const HAIR: ContactCase = {
  name: 'hair',
  light: { castsShadow: false, length: 0 },
  elevation: 10,
  x: -0.1,
  platform: 0.05,
  model: PIXEL_MODEL.hair,
}

const CASES: ContactCase[] = [
  WALL,
  { ...WALL, name: 'far', x: -6 },
  { ...WALL, name: 'unshadowed light', light: { castsShadow: false, length: 1, world: true } },
  { ...WALL, name: 'no length', light: { castsShadow: true, length: 0 } },
  { ...WALL, name: 'half intensity', light: { ...WALL.light, casting: 0.5 } },
  // A screen length is doubled before it is read: a quarter is the half metre that reaches the platform.
  { ...WALL, name: 'screen units', light: { castsShadow: true, length: 0.25 } },
  {
    ...WALL,
    name: 'override length',
    light: { castsShadow: true, length: 0 },
    override: [1, -1, -1, true],
  },
  { ...WALL, name: 'override casting', override: [-1, 0.25, -1, false] },
  { ...WALL, name: 'override off', override: [0, -1, -1, true] },
  { ...WALL, name: 'switched off', switchedOff: true },
  // The eye: half a centimetre toward any light, a platform a millimetre high.
  EYE,
  { ...EYE, name: 'eye hit', platformIsEye: true },
  { ...EYE, name: 'eye, switched off', switchedOff: true },
  { ...EYE, name: 'plain pixel', model: undefined },
  // The hair: a fifth of the screen under a light with no dynamic shadow, nothing under one with.
  HAIR,
  { ...HAIR, name: 'hair, shadowing light', light: { castsShadow: true, length: 0 } },
  { ...HAIR, name: 'hair, switched off', switchedOff: true },
  // The subsurface models let the light through by the density of their opacity.
  { ...WALL, name: 'skin', model: PIXEL_MODEL.skin, opacity: 0.5 },
  { ...WALL, name: 'subsurface', model: PIXEL_MODEL.subsurface, opacity: 0.5 },
  { ...WALL, name: 'foliage', thin: true, opacity: 0.5 },
  { ...WALL, name: 'profile', model: PIXEL_MODEL.profile, opacity: 0.5 },
]

let result: Record<string, number> = {}
before(async () => {
  const page = (await loadPage(
    resolve(import.meta.dirname, 'contactShadowPage.ts'),
    'contactShadowPage',
  )) as typeof import('./contactShadowPage.ts')
  const pageErrors: string[] = []
  const run = await runOnDawn(page.run, CASES, pageErrors)
  assert.ok(!('unavailable' in run), 'WebGPU must be available')
  assert.deepEqual([...run.errors, ...pageErrors], [])
  result = Object.fromEntries(CASES.map((c, k) => [c.name, run.results[k]]))
})

test('a light that casts a shadow and names a length is shadowed by what stands against the surface', () => {
  assert.equal(result.wall, 0, 'the platform is hit: the whole contact shadow')
  assert.equal(result.far, 1, 'nothing stands within the ray')
  assert.equal(
    result['screen units'],
    0,
    'a screen length is doubled: a quarter reaches the half metre',
  )
  assert.equal(result['half intensity'], 0.5)
})

test('a light that casts no shadow or names no length casts no ray', () => {
  assert.equal(result['unshadowed light'], 1)
  assert.equal(result['no length'], 1)
})

test('the view’s overrides replace the light’s length and intensities', () => {
  assert.equal(result['override length'], 0, 'a metre over a light that named none')
  assert.equal(result['override casting'], 0.75, 'a quarter of the shadow')
  assert.equal(result['override off'], 1, 'a length of 0 casts none')
  assert.equal(result['switched off'], 1, 'the lights cast no ray with the switch off')
})

test('the eye casts a ray of half a centimetre toward every light, and meets what casts no contact shadow as air', () => {
  assert.equal(result.eye, 0)
  assert.equal(result['eye hit'], 1, 'an eye hit casts the non-casting intensity: none')
  assert.equal(result['plain pixel'], 1, 'a pixel of no model casts none under such a light')
  assert.equal(result['eye, switched off'], 0, 'the eye’s ray does not follow the switch')
})

test('the hair casts a fifth of the screen under a light with no dynamic shadow, and none under one with', () => {
  assert.equal(result.hair, 0)
  assert.equal(result['hair, shadowing light'], 1)
  assert.equal(result['hair, switched off'], 0, 'nor does the hair’s')
})

test('the subsurface models let through the light that travels the hit distance, the profile and the eye do not', () => {
  // A hit between 31 and 56 cm, an opacity of a half: a density of 0.035 a centimetre.
  for (const name of ['skin', 'subsurface', 'foliage'])
    assert.ok(result[name] > 0.05 && result[name] < 0.5, `${name}: ${result[name]}`)
  assert.equal(result.profile, 0, 'a profile’s first hit is a blocker')
})
