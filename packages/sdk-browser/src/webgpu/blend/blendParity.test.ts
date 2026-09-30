// #558: multiply and subtractive colours are the witness's (three@0.174) in display space, after the
// tone curve (`displayFilter.ts`). The display layers that carry them take the colour the
// composition shows through its curve, route by their pipeline, and are sampled to the display.
import test from 'node:test';
import assert from 'node:assert/strict';
import { close, display, srgb } from './blendModel.fixture.ts';
import { ACES, displayFilterRun, displayRoute } from './displayRun.fixture.ts';
import { CONTRACT_COMPOSITIONS } from '../../lighting/deferred/shaders.ts';

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
