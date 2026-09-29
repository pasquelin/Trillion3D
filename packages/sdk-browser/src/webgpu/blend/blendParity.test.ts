// #558, measure ko: on WebGPU a multiplied surface over an opaque one let the background show
// through, `#20222a × (1 − alpha)`, where the witness (three@0.174) shows `d·s` alone. The lit
// target's alpha is the coverage the composition lays the background under; the witness draws
// over a canvas that already holds it. This follows one pixel through the transparent pass's own
// blend state (`blendTargets`) and the composition's weighting. Multiply and subtractive colours
// are the witness's in display space, after the tone curve (`displayFilter.ts`).
import test from 'node:test';
import assert from 'node:assert/strict';
import { blendTargets } from './pipelines.ts';
import { blend, close, shown, written, type Rgba } from './blendModel.fixture.ts';
import { DISPLAY_ROUTE_WGSL } from './displayFilter.ts';
import { DISPLAY_FILTER_SHADER } from './displayFilterProgram.ts';
import { BLEND_SHADER } from './shader.ts';
import { CONTRACT_COMPOSITIONS } from '../../lighting/deferred/shaders.ts';
import { ADD_EQUATIONS, TINT_EQUATIONS } from './equations.ts';
import type { Blending } from '../../../../sdk-core/src/world/constants/index.ts';

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

test('the display layers take the colour the composition shows, through its curve', () => {
  // The same exposure, curve and sRGB transfer as the composition's chain.
  assert.match(
    DISPLAY_ROUTE_WGSL,
    /linearToSrgb\(select\(toneMap\(rgb\*exposure,curve\),rgb,unlit\)\)/,
  );
  assert.match(
    BLEND_SHADER,
    /displayRoute\(rgb,uni\.exposure,uni\.toneCurve,unlit,s\.alpha,masked\)/,
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
  for (const mode of ['subtractive', 'multiply'] as const) {
    const targets = blendTargets(mode, 0xf, true, true);
    // The lit target keeps the paper; both layers take the ink's display colour (route 2).
    close([...written(targets[0], ink, paper)], [...paper], `${mode} lit target`);
    const tint = blend(targets.at(-2)!.blend!, shown(ink), [1, 1, 1, 1]);
    const add = blend(targets.at(-1)!.blend!, shown(ink), [0, 0, 0, 0]);
    // The composed paper times the tint, plus the added value (`DISPLAY_FILTER_SHADER`).
    const tinted = blend(TINT_EQUATIONS.multiply!, tint, shown(paper));
    const onScreen = blend(ADD_EQUATIONS.additive!, add, tinted);
    close(onScreen.slice(0, 3), WITNESS[mode](shown(ink), shown(paper)), `${mode} display`);
  }
});

test('the layers drawn below the display are sampled to it, not read at its pixel', () => {
  // The full-screen triangle's place: (0, 0) at the top left, (1, 1) at the bottom right of the
  // share the image covers (#832).
  assert.match(
    DISPLAY_FILTER_SHADER,
    /return Screen\(vec4f\(c,0\.0,1\.0\),\(vec2f\(0\.5,-0\.5\)\*c\+0\.5\)\*drawn\.xy\);/,
  );
  assert.match(DISPLAY_FILTER_SHADER, /textureSampleLevel\(map,layerSampler,uv,0\.0\)/);
  assert.doesNotMatch(DISPLAY_FILTER_SHADER, /textureLoad/);
});
