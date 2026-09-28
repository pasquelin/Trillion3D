// #558, measure ko: on WebGPU a multiplied surface over an opaque one let the background show
// through, `#20222a × (1 − alpha)`, where the witness (three@0.174) shows `d·s` alone. The lit
// target's alpha is the coverage the composition lays the background under; the witness draws
// over a canvas that already holds it. This follows one pixel through the transparent pass's own
// blend state (`blendTargets`) and the composition's weighting.
import test from 'node:test';
import assert from 'node:assert/strict';
import { blendTargets } from './pipelines.ts';
import type { Blending } from '../../../../sdk-core/src/world/constants/index.ts';

type Rgba = readonly [number, number, number, number];

/** A blend factor of WebGPU, applied to one channel `c` (3 is alpha). */
function factor(name: GPUBlendFactor, src: Rgba, dst: Rgba, c: number) {
  const table: Partial<Record<GPUBlendFactor, number>> = {
    zero: 0,
    one: 1,
    src: src[c],
    'one-minus-src': 1 - src[c],
    'src-alpha': src[3],
    'one-minus-src-alpha': 1 - src[3],
    dst: dst[c],
    'dst-alpha': dst[3],
  };
  const value = table[name];
  if (value === undefined) throw new Error(`factor ${name} is not modelled`);
  return value;
}

/** What the pass writes for `src` over `dst` in `mode`: its target's own blend state. */
function blended(mode: Blending, src: Rgba, dst: Rgba): Rgba {
  const state = blendTargets(mode, 0xf, true)[0].blend!;
  const channel = (c: number) => {
    const part = c === 3 ? state.alpha : state.color;
    assert.equal(part.operation ?? 'add', 'add');
    return (
      src[c] * factor(part.srcFactor ?? 'one', src, dst, c) +
      dst[c] * factor(part.dstFactor ?? 'zero', src, dst, c)
    );
  };
  return [channel(0), channel(1), channel(2), channel(3)];
}

/** The composition's weighting, the tone curve left out: the colour at its coverage, the
 *  background under the rest (`composeColor`). */
const composed = ([r, g, b, a]: Rgba, background: Rgba) =>
  [r, g, b].map((value, c) => (value / a) * a + background[c] * (1 - a));

/** What the witness shows on its opaque canvas: the mode's colour equation over `dst`. */
const WITNESS: Record<'normal' | 'subtractive' | 'multiply', (s: Rgba, d: Rgba) => number[]> = {
  normal: (s, d) => [0, 1, 2].map((c) => s[c] * s[3] + d[c] * (1 - s[3])),
  subtractive: (s, d) => [0, 1, 2].map((c) => d[c] * (1 - s[c])),
  multiply: (s, d) => [0, 1, 2].map((c) => d[c] * s[c]),
};

const close = (actual: number[], expected: number[], mode: string) =>
  actual.forEach((value, c) => assert.ok(Math.abs(value - expected[c]) < 1e-6, `${mode} ${c}`));

test('over an opaque surface the three modes show what the witness shows, no background', () => {
  const background: Rgba = [0.016, 0.017, 0.023, 1];
  const ink: Rgba = [1, 0.023, 0.023, 0.8];
  for (const surface of [
    [0.0015, 0.0018, 0.003, 1],
    [0.89, 0.85, 0.78, 1],
  ] as Rgba[])
    for (const mode of ['normal', 'subtractive', 'multiply'] as const) {
      const pixel = blended(mode, ink, surface);
      assert.ok(Math.abs(pixel[3] - 1) < 1e-9, `${mode} keeps the surface covered`);
      close(composed(pixel, background), WITNESS[mode](ink, surface), mode);
    }
});

test('three multiplied discs over the night half stay black', () => {
  const background: Rgba = [0.016, 0.017, 0.023, 1];
  let pixel: Rgba = [0.0015, 0.0018, 0.003, 1];
  for (let disc = 0; disc < 3; disc++) pixel = blended('multiply', [0.9, 0.9, 0.9, 0.8], pixel);
  close(
    composed(pixel, background),
    [0.0015, 0.0018, 0.003].map((v) => v * 0.729),
    'multiply',
  );
});
