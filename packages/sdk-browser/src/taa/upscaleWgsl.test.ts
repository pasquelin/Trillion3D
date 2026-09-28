import test from 'node:test';
import assert from 'node:assert/strict';
import { shaderFunctions } from '../texture/shaderRule.fixture.ts';
import { LANCZOS2_WGSL, taaUpscaleShader } from './upscaleWgsl.ts';
import { TAA_SHADER, taaHistoryBlend } from './shaderWgsl.ts';

type Kernel = { lanczos2: (x: number) => number };

test('the current image is resampled with Lanczos-2: one at its sample, zero at each integer', () => {
  const { lanczos2 } = shaderFunctions<Kernel>(LANCZOS2_WGSL, ['lanczos2'], { sin: Math.sin });
  assert.equal(lanczos2(0), 1);
  for (const x of [1, 2, 3]) assert.ok(Math.abs(lanczos2(x)) < 1e-6, `zero at ${x}`);
  assert.ok(lanczos2(0.5) > 0 && lanczos2(1.5) < 0, 'its negative lobe, which deringing clamps');
  const sinc = (x: number) => Math.sin(Math.PI * x) / (Math.PI * x);
  assert.ok(Math.abs(lanczos2(0.7) - sinc(0.7) * sinc(0.35)) < 1e-6);
});

// #816: a frame drawn below the display is reconstructed per display pixel, from the render grid.
test('the upscaling resolve dilates depth, derings its sample and keeps the native history blend', () => {
  const shader = taaUpscaleShader(true);
  // The display pixel's place in the render grid, texel centres at integers.
  assert.match(shader, /let r=pixel\.xy\*view\.viewport\.zw\*view\.render\.xy-0\.5;/);
  // Depth dilation: the nearest surface — reversed depth, the greatest — names the reprojection.
  assert.match(shader, /if\(z>nearDepth\)\{nearDepth=z;near=at;\}/);
  assert.match(shader, /previousUv\(coord,nearDepth,near\)/);
  // Each texel weighed from where this frame sampled it, jitter in render pixels.
  assert.match(shader, /let sampled=vec2f\(-view\.jitter\.x,view\.jitter\.y\)-r;/);
  assert.match(shader, /lanczos2\(length\(vec2f\(at\)\+sampled\)\)/);
  // Deringing: clamped to the 2×2 nearest texels.
  assert.match(shader, /clamp\(sum\/max\(total,1e-4\),ringLo,ringHi\)/);
  // History: the native resolve's clamp and inverse-luminance blend, the same text.
  for (const asIs of [true, false])
    assert.ok(taaUpscaleShader(asIs).includes(taaHistoryBlend(asIs)));
  assert.ok(TAA_SHADER.includes(taaHistoryBlend(true)));
  // The flagless one reads neither flags nor share history.
  assert.doesNotMatch(taaUpscaleShader(false), /var flags|textureLoad\(flags|shareHistory/);
});
