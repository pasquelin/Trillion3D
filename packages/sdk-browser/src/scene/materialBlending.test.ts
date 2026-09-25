import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BLEND_EQUATIONS,
  BLEND_MODES,
  blendingOf,
  composesWithBackground,
  drawnBlending,
  hostBlending,
  weighsByAlpha,
} from './materialBlending.ts';
import * as G from '../host/graph/graph.fixture.ts';
import { clusterMaterialReason } from '../host/surfaceGate.ts';

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
  };
  return s * factors[component.srcFactor!] + d * factors[component.dstFactor!];
}

// #346, #558: the pixel each mode leaves over a known background, in linear light, colour and
// alpha as the witness composes them.
test('each mode composes source and background by its own equation', () => {
  const s = 0.5,
    a = 0.6,
    d = 0.4,
    t = 0.8;
  const close = (mode: keyof typeof BLEND_EQUATIONS, colour: number, alpha: number) => {
    const { color, alpha: component } = BLEND_EQUATIONS[mode]!;
    assert.ok(Math.abs(channel(color, s, a, d) - colour) < 1e-9, `${mode} colour`);
    assert.ok(Math.abs(channel(component, a, a, t) - alpha) < 1e-9, `${mode} alpha`);
  };
  close('normal', s * a + d * (1 - a), a + t * (1 - a));
  close('additive', d + s * a, t + a * a);
  close('subtractive', d * (1 - s), t);
  close('multiply', d * s, t * a);
  assert.equal(BLEND_EQUATIONS.none, undefined, 'none replaces the target');
});

// One refusal: what the admission gate names is what a draw would throw, word for word.
test('the gate and the draws refuse a blending by the same words', () => {
  const position = new G.BufferAttribute(new Float32Array(9), 3),
    normal = new G.BufferAttribute(new Float32Array(9), 3);
  const refusal = (mode: Parameters<typeof drawnBlending>[0], transmissive: boolean) => {
    try {
      drawnBlending(mode, transmissive);
    } catch (error) {
      return (error as Error).message;
    }
  };
  const custom = G.basicSurface({ transparent: true, blending: 5 });
  assert.ok(clusterMaterialReason(custom, { position })!.includes(refusal(undefined, false)!));
  const glass = G.physicalSurface({ transmission: 1, blending: hostBlending('additive') });
  assert.ok(
    clusterMaterialReason(glass, { position, normal }, true)!.includes(refusal('additive', true)!),
  );
});

test('only the modes that weigh the source colour by its alpha take that alpha as coverage', () => {
  assert.deepEqual(BLEND_MODES.filter(weighsByAlpha), ['normal', 'additive']);
  assert.equal(weighsByAlpha(undefined), false, 'a mode no path draws weighs nothing');
});
