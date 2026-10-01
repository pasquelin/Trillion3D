// #831: a receiver whose page is not drawn yet reads the next coarser level, and its bias — the
// normal offset and the slope-scaled depth margin — is that level's texels, never the level it
// asked for. Biased in the finer texels, a slope reading a coarse page shades itself in grain and
// triangles while a drive lasts; biased in the texels it reads, it stays clean.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BIAS, SHADOW_WGSL, sunOverProfile, type Bias, type Face } from './shadowBias.fixture.ts';

/** A face of the terrain tilted by `tilt` radians, 2 m long. */
const slope = (tilt: number): Face => ({
  from: [-Math.cos(tilt), -Math.sin(tilt)],
  to: [Math.cos(tilt), Math.sin(tilt)],
  normal: [-Math.sin(tilt), Math.cos(tilt)],
});

/** The lit share of 97 points along `face`, read at a level of `texel` metres under `bias`. */
const share = (face: Face, zenith: number, texel: number, bias: Bias) => {
  const read = sunOverProfile([face], zenith, texel, 0, bias);
  const lit = Array.from({ length: 97 }, (_, k) => read(0, (k + 1) / 98));
  return lit.reduce((sum, value) => sum + value, 0) / lit.length;
};

test('each level the read falls back to offsets and margins the receiver in its own texels', () => {
  // The loop over the levels reads its point and its margin at the level it tries, not the first.
  const loop = SHADOW_WGSL.slice(SHADOW_WGSL.indexOf('fn sunShadowFactor('));
  const body = loop.slice(
    loop.indexOf('for(var level='),
    loop.indexOf('return sunFarShadowFactor'),
  );
  assert.ok(body.includes('let at=sunReadAt(index,P,N,offset,level);'));
  assert.ok(body.includes('shadowDepthMargin(at.texel,slope,1.0)'));
  assert.ok(SHADOW_WGSL.includes(' let texel=shadowSunTexelMetres(level);'));
});

test('a slope read at a coarser level is clean in that level’s texels, grained in the finer ones', () => {
  const fallbacks = [2, 4, 8];
  let grain = 0;
  for (const tilt of [0.3, 0.6, 0.9])
    for (const zenith of [0.6, 1.0, 1.3])
      for (const coarser of fallbacks) {
        const texel = 0.02 * coarser,
          asked: Bias = (t, cosine) => BIAS(t / coarser, cosine);
        assert.equal(share(slope(tilt), zenith, texel, BIAS), 1, `${tilt} ${zenith} ×${coarser}`);
        if (share(slope(tilt), zenith, texel, asked) < 1) grain++;
      }
  assert.ok(grain >= 9, `the finer level's bias grains the coarser read: ${grain} of 27`);
});
