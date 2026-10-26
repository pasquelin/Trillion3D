import test from 'node:test'
import assert from 'node:assert/strict'
import {
  BLEND_EQUATIONS,
  BLEND_MODES,
  composesWithBackground,
  drawnBlending,
  modulatesScene,
  weighsByAlpha,
} from './materialBlending.ts'

test('the modes that compose with the background are the ones that need one', () => {
  assert.deepEqual(BLEND_MODES.filter(composesWithBackground), [
    'additive',
    'subtractive',
    'multiply',
    'alphaHoldout',
  ])
})

test('the modes that multiply the scene are the two that filter it', () => {
  assert.deepEqual(BLEND_MODES.filter(modulatesScene), ['subtractive', 'multiply'])
})

/** One channel through a blend component, as the GPU fixed function computes it: `s` the
 *  source's value in that channel, `a` its alpha, `d` the target's value. */
function channel(component: GPUBlendComponent, s: number, a: number, d: number) {
  const factors: Record<string, number> = {
    zero: 0,
    one: 1,
    src: s,
    'one-minus-src': 1 - s,
    'src-alpha': a,
    'one-minus-src-alpha': 1 - a,
  }
  return s * factors[component.srcFactor!] + d * factors[component.dstFactor!]
}

// The pixel each mode leaves over a known target, in linear light: its colour, and its alpha, the
// transmittance, as the translucency target holds them.
test('each mode composes source and target by its own equation', () => {
  const s = 0.5,
    a = 0.6,
    d = 0.4,
    t = 0.8
  const close = (mode: keyof typeof BLEND_EQUATIONS, colour: number, alpha: number) => {
    const { color, alpha: component } = BLEND_EQUATIONS[mode]
    assert.ok(Math.abs(channel(color, s, a, d) - colour) < 1e-9, `${mode} colour`)
    assert.ok(Math.abs(channel(component, a, a, t) - alpha) < 1e-9, `${mode} alpha`)
  }
  close('normal', s * a + d * (1 - a), t * (1 - a))
  close('additive', d + s * a, t)
  close('subtractive', d * (1 - s), t)
  close('multiply', d * s, t)
  close('alphaComposite', s + d * (1 - a), t * (1 - a))
  close('alphaHoldout', d * (1 - a), t * (1 - a))
})

// One refusal: a mode no path draws is thrown by name, never drawn as normal.
test('the draws refuse an unnamed mode, and a transmissive one other than normal, by name', () => {
  assert.throws(
    () => drawnBlending(undefined, false),
    /a surface declares a blending no path draws/,
  )
  assert.throws(() => drawnBlending('additive', true), /transmissive material cannot use additive/)
  assert.equal(drawnBlending('normal', true), 'normal')
  assert.equal(drawnBlending('multiply', false), 'multiply')
})

test('only the modes whose alpha is the layer’s coverage take it as such', () => {
  assert.deepEqual(BLEND_MODES.filter(weighsByAlpha), [
    'normal',
    'additive',
    'alphaComposite',
    'alphaHoldout',
  ])
  assert.equal(weighsByAlpha(undefined), false, 'a mode no path draws weighs nothing')
  // …which is what their equations say: the colour is weighed by the alpha or by what it leaves.
  for (const mode of BLEND_MODES) {
    const { color } = BLEND_EQUATIONS[mode]
    const weighs = color.srcFactor === 'src-alpha' || color.dstFactor === 'one-minus-src-alpha'
    assert.equal(weighsByAlpha(mode), weighs, mode)
  }
})
