import test from 'node:test';
import assert from 'node:assert/strict';
import { reflectionConeShader } from './coneShader.ts';
import { shaderFunctions } from '../texture/shaderRule.fixture.ts';

import { ggxIntegral } from './ggxIntegral.fixture.ts';

for (const language of ['wgsl', 'glsl'] as const)
  test(`${language} cone aperture encloses half the weighted GGX lobe and grows with roughness`, () => {
    const shader = shaderFunctions<{ reflectionConeSlope(rough: number): number }>(
      reflectionConeShader(language),
      ['reflectionGgxMass', 'reflectionConeSlope'],
      { abs: Math.abs, log: Math.log, sqrt: Math.sqrt },
    );
    let previous = 0;
    for (const rough of [0.02, 0.05, 0.1, 0.25, 0.5, 0.8, 0.98, 1]) {
      const slope = shader.reflectionConeSlope(rough);
      assert.ok(slope > previous && slope <= 1.0001);
      previous = slope;
      const cosine = 1 / Math.sqrt(1 + slope * slope),
        k = rough ** 4;
      const u = (1 - cosine) / (1 + k + cosine * (k - 1));
      const share = ggxIntegral(k, u) / ggxIntegral(k, 1 / (1 + k));
      assert.ok(Math.abs(share - 0.5) < 2e-5, `roughness ${rough}: ${share}`);
    }
    assert.equal(shader.reflectionConeSlope(0), 0);
    assert.ok(Math.abs(shader.reflectionConeSlope(1) - 1) < 1e-4);
  });
