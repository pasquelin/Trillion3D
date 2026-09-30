// #558, measure ko: on WebGPU a multiplied surface over an opaque one let the background show
// through, `#20222a × (1 − alpha)`, where the witness (three@0.174) shows `d·s` alone. The lit
// target's alpha is the coverage the composition lays the background under; the witness draws
// over a canvas that already holds it. This follows one pixel through the transparent pass's own
// blend state (`blendTargets`) and the composition's weighting. Multiply and subtractive colours
// are the witness's in display space, after the tone curve (`displayFilter.ts`).
import test from 'node:test';
import assert from 'node:assert/strict';
import { blend, close, display, shown, srgb, written, type Rgba } from './blendModel.fixture.ts';
import { ACES, displayFilterRun, displayRoute } from './displayRun.fixture.ts';
import { CONTRACT_COMPOSITIONS } from '../../lighting/deferred/shaders.ts';
import { ADD_EQUATIONS, TINT_EQUATIONS } from './equations.ts';
import type { Blending } from '../../../../sdk-core/src/world/constants/index.ts';
import { blendTargets } from './blendTargets.ts';

/** What the pass writes for `src` over `dst` in `mode`: its target's own blend state. */
const blended = (mode: Blending, src: Rgba, dst: Rgba) =>
  blend(blendTargets(mode, 0xf, true)[0]!.blend!, src, dst);

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
  // The shipped route: exposure, the curve unless unlit, then sRGB, as the composition's chain;
  // its sRGB exponent, 0.41666, is 1/2.4 within 1e-4 over [0, 4].
  const colour = [4, 0.02, 0.3];
  for (const [exposure, unlit] of [
    [1, false],
    [0.5, false],
    [2, true],
  ] as const) {
    const owed = unlit ? srgb(colour) : display(colour.map((v) => v * exposure));
    const { keep, tint, add } = displayRoute[2](colour, exposure, ACES, unlit, 0.8, 1);
    assert.equal(keep, 1);
    close(tint, [...owed, 1], `tint ${exposure}`, 1e-4);
    close(add, [...owed, 1], `add ${exposure}`, 1e-4);
  }
  assert.match(
    CONTRACT_COMPOSITIONS.plain.still,
    /toneMap\(value\.rgb\*view\.lightParams\.w\/max\(value\.a,1e-6\),u32\(view\.display\.x\)\)/,
  );
});

test('a layer routes by its pipeline: nothing, where masked, or always', () => {
  const colour = [0.5, 0.25, 0.1],
    owed = display(colour);
  const none = displayRoute[0](colour, 1, ACES, false, 0.6, 1);
  assert.deepEqual(none, { keep: 1, tint: [1, 1, 1, 1], add: [0, 0, 0, 0] });
  for (const masked of [0, 1]) {
    const { keep, tint, add } = displayRoute[1](colour, 1, ACES, false, 0.6, masked);
    const a = 0.6 * masked;
    assert.equal(keep, 1 - masked);
    close(tint, [0, 0, 0, a], `tint ${masked}`);
    close(add, [...owed.map((v) => v * a), a], `add ${masked}`, 1e-5);
  }
});

test('subtractive and multiply over paper show the witness in display space', () => {
  // A red ink disc over paper, both lit, in linear light: ACES mixes the channels, so the linear
  // equation left R = 132 where the witness shows 0 on the measured scene.
  const paper: Rgba = [0.89, 0.85, 0.78, 1];
  const ink: Rgba = [4, 0.02, 0.02, 0.8];
  for (const mode of ['subtractive', 'multiply'] as const) {
    const targets = blendTargets(mode, 0xf, true, true);
    // The lit target keeps the paper; both layers take the ink's display colour (route 2).
    close([...written(targets[0]!, ink, paper)], [...paper], `${mode} lit target`);
    const route = displayRoute[2](ink.slice(0, 3), 1, ACES, false, ink[3], 1);
    const tint = blend(targets.at(-2)!.blend!, route.tint, [1, 1, 1, 1]);
    const add = blend(targets.at(-1)!.blend!, route.add, [0, 0, 0, 0]);
    // The display filter pass: the composed paper times the tint, plus the added value.
    const filter = displayFilterRun(
      [1, 1],
      () => [...tint],
      () => [...add],
    );
    const at = filter.screen(0);
    const tinted = blend(TINT_EQUATIONS.multiply!, filter.tint(at).canvas, shown(paper));
    const onScreen = blend(ADD_EQUATIONS.additive!, filter.add(at).canvas, tinted);
    const owed = WITNESS[mode](shown(ink), shown(paper));
    close(onScreen.slice(0, 3), owed, `${mode} display`, 1e-5);
  }
});

test('the layers drawn below the display are sampled to it, not read at its pixel', () => {
  // The full-screen triangle's place: (0, 0) at the top left, (1, 1) at the bottom right of the
  // share the image covers (#832), sampled there, level 0, on both outputs.
  const drawn: [number, number] = [0.5, 0.75],
    layer = (uv: number[]) => [uv[0], uv[1], 0.25, 0.5];
  const filter = displayFilterRun(drawn, layer, (uv) => layer(uv).map((v) => 1 - v));
  const corners = [0, 1, 2].map(filter.screen);
  assert.deepEqual(
    corners.map(({ position }) => position),
    [
      [-1, -1, 0, 1],
      [3, -1, 0, 1],
      [-1, 3, 0, 1],
    ],
  );
  // The place the rasteriser interpolates at clip `(x, y)`, from the triangle's three corners.
  const placeAt = (x: number, y: number) => {
    const weights = [1 - (x + 1) / 4 - (y + 1) / 4, (x + 1) / 4, (y + 1) / 4];
    return [0, 1].map((i) => corners.reduce((sum, { uv }, k) => sum + uv[i] * weights[k], 0));
  };
  close(placeAt(-1, 1), [0, 0], 'top left');
  close(placeAt(1, -1), drawn, 'bottom right');
  const at = { position: [0, 0, 0, 1], uv: [0.2, 0.3] };
  for (const [name, owed] of [
    ['tint', [0.2, 0.3, 0.25, 1]],
    ['add', [0.8, 0.7, 0.75, 1]],
  ] as const) {
    const { capture, canvas } = filter[name](at);
    close(capture, owed, `${name} capture`);
    close(canvas, owed, `${name} canvas`);
  }
});
