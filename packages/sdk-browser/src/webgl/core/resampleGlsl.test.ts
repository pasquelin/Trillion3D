// #834: WebGL2 resamples with the temporal upscale's own kernel, Lanczos-2, its GLSL derived from
// the WGSL text: the resample weighs by the kernel and clamps to its 2×2 deringing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LANCZOS2_GLSL } from '../../taa/upscaleWgsl.ts';
import { resampleFragment } from './resampleGlsl.ts';

test('the resample weighs its 3×3 texels by Lanczos-2 and clamps to the 2×2 nearest', () => {
  for (const untoned of [false, true]) {
    const text = resampleFragment(untoned);
    assert.ok(text.includes(LANCZOS2_GLSL));
    assert.match(text, /lanczos2\(length\(vec2\(at\)-r\)\)/);
    assert.match(text, /color=clamp\(sum\/max\(total,1e-4\),lo,hi\)/);
    assert.equal(/untonedOut=/.test(text), untoned);
  }
});
