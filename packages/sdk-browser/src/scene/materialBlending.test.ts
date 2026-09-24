import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BLEND_EQUATIONS,
  BLEND_MODES,
  blendingOf,
  composesWithBackground,
  hostBlending,
} from './materialBlending.ts';

test('every engine mode maps to a host constant and back; an unnamed one is undefined', () => {
  for (const mode of BLEND_MODES) assert.equal(blendingOf(hostBlending(mode)), mode, mode);
  assert.equal(blendingOf(undefined), 'normal', 'the host default is normal');
  assert.equal(blendingOf(5), undefined, 'a custom equation is no mode the engine draws');
  assert.deepEqual(BLEND_MODES.filter(composesWithBackground), [
    'additive',
    'subtractive',
    'multiply',
  ]);
});

/** One colour channel through a blend component, as the GPU fixed function computes it. */
function channel(component: GPUBlendComponent, s: number, a: number, d: number) {
  const factor = (name: GPUBlendFactor | undefined) =>
    ({ zero: 0, one: 1, src: s, 'src-alpha': a, 'one-minus-src-alpha': 1 - a })[name as string]!;
  const src = s * factor(component.srcFactor),
    dst = d * factor(component.dstFactor);
  return component.operation === 'reverse-subtract' ? dst - src : src + dst;
}

// #346: the pixel each mode leaves over a known background, in linear light.
test('each mode composes source and background by its own equation', () => {
  const s = 0.5,
    a = 0.6,
    d = 0.4,
    close = (mode: keyof typeof BLEND_EQUATIONS, expected: number) =>
      assert.ok(Math.abs(channel(BLEND_EQUATIONS[mode]!.color, s, a, d) - expected) < 1e-9, mode);
  close('normal', s * a + d * (1 - a));
  close('additive', d + s * a);
  close('subtractive', d - s * a);
  close('multiply', d * s);
  assert.equal(BLEND_EQUATIONS.none, undefined, 'none replaces the target');
});
