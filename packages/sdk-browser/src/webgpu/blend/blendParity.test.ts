// #558, measure ko: on WebGPU a multiplied surface over an opaque one let the background show
// through, `#20222a × (1 − alpha)`, where the witness (three@0.174) shows `d·s` alone. The lit
// target's alpha is the coverage the composition lays the background under; the witness draws
// over a canvas that already holds it. This follows one pixel through the transparent pass's own
// blend state (`blendTargets`) and the composition's weighting. Multiply and subtractive colours
// are the witness's in display space, after the tone curve (`displayFilter.ts`).
import test from 'node:test';
import assert from 'node:assert/strict';
import { blendTargets } from './pipelines.ts';
import { DISPLAY_FILTER_WGSL } from './displayFilter.ts';
import { CONTRACT_COMPOSITIONS } from '../../lighting/deferred/shaders.ts';
import { FILTER_EQUATIONS } from '../../scene/materialBlending.ts';
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

/** What `state` writes for `src` over `dst`. */
function blend(state: GPUBlendState, src: Rgba, dst: Rgba): Rgba {
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

/** What the pass writes for `src` over `dst` in `mode`: its target's own blend state. */
const blended = (mode: Blending, src: Rgba, dst: Rgba) =>
  blend(blendTargets(mode, 0xf, true)[0].blend!, src, dst);

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

/** The witness's display value of a linear colour: three@0.174's ACES filmic fit, then sRGB. */
function display([r, g, b]: readonly number[]): number[] {
  const c = [r, g, b].map((v) => v / 0.6);
  const into = [0.59719, 0.076, 0.0284, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777];
  const out = [
    1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602,
  ];
  const times = (m: number[], v: number[]) =>
    [0, 1, 2].map((i) => m[i] * v[0] + m[3 + i] * v[1] + m[6 + i] * v[2]);
  const fit = times(into, c).map(
    (v) => (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.432951) + 0.238081),
  );
  return times(out, fit).map((v) => {
    const x = Math.min(1, Math.max(0, v));
    return x < 0.0031308 ? x * 12.92 : 1.055 * x ** (1 / 2.4) - 0.055;
  });
}

/** The display value of `colour`, opaque. */
const shown = (colour: Rgba): Rgba => {
  const [r, g, b] = display(colour);
  return [r, g, b, 1];
};

test('the display filter writes the colour the composition shows, through its curve', () => {
  // The same exposure, curve and sRGB transfer as the composition's chain.
  assert.match(
    DISPLAY_FILTER_WGSL,
    /linearToSrgb\(select\(toneMap\(rgb\*uni\.exposure,uni\.toneCurve\),rgb,unlit\)\)/,
  );
  assert.match(
    CONTRACT_COMPOSITIONS.plain.still,
    /toneMap\(value\.rgb\*view\.lightParams\.w\/max\(value\.a,1e-6\),u32\(view\.display\.x\)\)/,
  );
});

test('subtractive and multiply over paper show the witness in display space', () => {
  // A red ink disc over paper, both lit, in linear light: ACES mixes the channels, so the linear
  // equation left R = 132 where the witness shows 0 on the measured scene.
  const paper: Rgba = [0.89, 0.85, 0.78, 1];
  const ink: Rgba = [4, 0.02, 0.02, 0.8];
  const white: Rgba = [1, 1, 1, 1];
  for (const mode of ['subtractive', 'multiply'] as const) {
    const targets = blendTargets(mode, 0xf, true, true);
    // The lit target keeps the paper; the filter takes the ink's display colour.
    const lit = blend(targets[0].blend!, ink, paper);
    close([...lit], [...paper], `${mode} lit target`);
    const filter = blend(targets.at(-1)!.blend!, shown(ink), white);
    // The composed paper, times the filter (`DISPLAY_FILTER_SHADER`'s blend).
    const onScreen = blend(FILTER_EQUATIONS.multiply!, filter, shown(paper));
    close(onScreen.slice(0, 3), WITNESS[mode](shown(ink), shown(paper)), `${mode} display`);
  }
});

test('a normal surface in front lifts the filter where it covers it, additive keeps it', () => {
  const filter: Rgba = [0.2, 0.5, 0.5, 1];
  const lifted = blend(
    blendTargets('normal', 0xf, true, true).at(-1)!.blend!,
    [1, 1, 1, 0.75],
    filter,
  );
  close(lifted.slice(0, 3), [0.8, 0.875, 0.875], 'normal');
  const kept = blend(
    blendTargets('additive', 0xf, true, true).at(-1)!.blend!,
    [1, 1, 1, 0.75],
    filter,
  );
  close(kept.slice(0, 3), [0.2, 0.5, 0.5], 'additive');
});
