// #831: a shadow read biases along the receiver's own triangle, not its smooth shading normal. Over
// a coarse terrain the vertex normals lean off each triangle's plane; biased along them, a texel of
// the triangle shades its own neighbours — teeth along every edge as the sun grazes. Biased along
// the plane the caster drew, the triangle stays clean, as `sunOverProfile` reads a face.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sunOverProfile, type Face } from './shadowBias.fixture.ts';
import { declaredLightWgsl } from './lightLoopWgsl.ts';
import { shadowDemandWgsl } from '../../webgpu/shadow/demandWgsl.ts';

/** A triangle's slope of the terrain, read with `normal`: its plane's, or a smooth one leaning by
 *  `lean` radians toward the sun, as a vertex normal does over a coarse triangle. */
const slope = (tilt: number, lean: number): Face => ({
  from: [-1, -Math.tan(tilt)],
  to: [1, Math.tan(tilt)],
  normal: [-Math.sin(tilt + lean), Math.cos(tilt + lean)],
});

/** The lit share of 97 points along the face, ends excluded. */
const share = (face: Face, zenith: number, texel: number) => {
  const read = sunOverProfile([face], zenith, texel);
  const points = Array.from({ length: 97 }, (_, k) => read(0, (k + 1) / 98));
  return points.reduce((sum, lit) => sum + lit, 0) / points.length;
};

test('a triangle biased along its own plane is clean where its smooth normal leaves teeth', () => {
  let teeth = 0;
  for (const tilt of [0, 0.2, 0.5])
    for (const zenith of [0.8, 1.2])
      for (const texel of [0.01, 0.5]) {
        assert.equal(share(slope(tilt, 0), zenith, texel), 1, `plane ${tilt} ${zenith} ${texel}`);
        if (share(slope(tilt, 0.4), zenith, texel) < 1) teeth++;
      }
  assert.ok(teeth >= 10, `the smooth normal shades the triangle itself: ${teeth} of 12`);
});

test('the shading and the demand both bias along the receiver plane', () => {
  assert.ok(declaredLightWgsl(true).includes('shadowBiasNormal(select(N,-N,back))'));
  assert.ok(shadowDemandWgsl().includes('let N=shadowBiasNormal('));
});
