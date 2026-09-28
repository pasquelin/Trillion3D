// #26: the page read's result never depends on how the sampler turns a normalised coordinate back
// into texels, which WebGPU leaves to the device — `at / texels` is rarely exact on a pool side
// that is not a power of two, and the observed 1 px flips show a device rounding it past #831's
// half-step margin. The shipped `shadowSample`, one axis, over a sampler that errs by a step.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SHADOW_PAGE, pageOrigin } from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { shaderFunctions } from '../../texture/shaderRule.fixture.ts';
import { SHADOW_SAMPLE_WGSL, SHADOW_SUBTEXELS as STEPS } from './shadowSampleWgsl.ts';
import { compare } from './shadowBias.fixture.ts';
import { hash } from './shadowPages.fixture.ts';

type Lit = { x: number; y: number; z: number; w: number };
type Sample = { shadowSample: (at: number, layer: number, texels: number, ref: number) => number };
type Blend = { shadowBilinear: (lit: Lit, w: { x: number; y: number }) => number };

const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/** The shipped `shadowSample` over a sampler that reads the texel coordinate `uv · texels` off by
 *  `error`, in a layer `texels` a side whose page at `origin` holds `hash(texel)`, the rest noise.
 *  Develop's filtered comparison and the gather are both the device's: a test of either form. */
function sampleAt(origin: number, error: number, texels: number) {
  const depth = (x: number) => {
    const local = Math.floor(x) - origin;
    return local >= 0 && local < SHADOW_PAGE ? hash(local) : hash(Math.floor(x) * 7 + 3);
  };
  const at = (uv: number) => uv * texels + error;
  const device = {
    floor: Math.floor,
    shadowAtlas: null,
    shadowSampler: null,
    textureSampleCompareLevel: (_t: null, _s: null, uv: number, _l: number, ref: number) =>
      compare(at(uv), 0.5, depth, ref, STEPS),
    textureGatherCompare(_t: null, _s: null, uv: number, _l: number, ref: number): Lit {
      const low = Math.floor(at(uv) - 0.5) + 0.5;
      const [a, b] = [low, low + 1].map((x) => compare(x, 0.5, depth, ref));
      return { x: a, y: b, z: b, w: a };
    },
    shadowBilinear: (lit: Lit, w: number) => mix(lit.w, lit.z, w),
  };
  return shaderFunctions<Sample>(SHADOW_SAMPLE_WGSL, ['shadowSample'], device).shadowSample;
}

test('a page reads the same comparison wherever it lies, however the sampler rounds (#26)', () => {
  for (const pages of [51, 53, 64]) {
    const texels = pages * SHADOW_PAGE;
    const reads = [0, 17, pages - 1, pages * 30 + 7].flatMap((k) => {
      const origin = pageOrigin(k, pages).x;
      return [-1 / STEPS, 0, 1 / STEPS].map((error) => ({
        origin,
        sample: sampleAt(origin, error, texels),
      }));
    });
    for (let step = 0.5 * STEPS; step <= (SHADOW_PAGE - 0.5) * STEPS; step += 97) {
      const read = new Set(
        reads.map(({ origin, sample }) => sample(origin + step / STEPS, 0, texels, 0.5)),
      );
      assert.equal(read.size, 1, `side ${pages}, texel ${step / STEPS}`);
    }
  }
});

test('the gathered comparisons are weighted in textureGatherCompare’s order', () => {
  const { shadowBilinear } = shaderFunctions<Blend>(SHADOW_SAMPLE_WGSL, ['shadowBilinear'], {
    mix,
  });
  // x: (low u, high v), y: (high u, high v), z: (high u, low v), w: (low u, low v).
  const lit = { x: 3, y: 5, z: 7, w: 11 };
  assert.equal(shadowBilinear(lit, { x: 0, y: 0 }), 11);
  assert.equal(shadowBilinear(lit, { x: 1, y: 0 }), 7);
  assert.equal(shadowBilinear(lit, { x: 0, y: 1 }), 3);
  assert.equal(shadowBilinear(lit, { x: 1, y: 1 }), 5);
  assert.equal(shadowBilinear(lit, { x: 0.25, y: 0.5 }), 0.5 * (11 + 0.25 * -4) + 0.5 * (3 + 0.5));
});
