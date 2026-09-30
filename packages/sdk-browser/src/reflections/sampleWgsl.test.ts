import test from 'node:test';
import assert from 'node:assert/strict';
import { stochasticReflectionShader } from './sampleWgsl.ts';
import { contractLightingShader } from '../lighting/deferred/shaders.ts';
import { functionsOf } from '../texture/shaderRule.fixture.ts';
import { MIRROR_TRANSITION_END } from './modelShader.ts';

const trace = (bounce: boolean, unbounded: boolean) =>
  functionsOf(stochasticReflectionShader(contractLightingShader(bounce, false), unbounded), [
    'traceRoughReflection',
  ]);

test('a rough sample spends the bounded Hi-Z walk, and a miss reads the filtered probes, never a proxy ray', () => {
  for (const bounce of [false, true]) {
    const sample = trace(bounce, false);
    assert.match(sample, /screenReflectionHiZ\(P,sample\.xyz\)/);
    assert.ok(
      sample.includes(`filteredReflectedRadiance(P,N,sample.xyz,${MIRROR_TRANSITION_END})`),
    );
    assert.doesNotMatch(sample, /resolvedReflectionRay|reflectedRadiance\(|proxyReflectionRay/);
  }
});

test("a reference session's program walks the whole ray with the program's whole fallback", () => {
  for (const bounce of [false, true]) {
    const sample = trace(bounce, true);
    assert.match(sample, /return vec4f\(resolvedReflectionRay\(P,N,sample\.xyz\),sample\.w\);/);
    assert.doesNotMatch(sample, /screenReflectionHiZ/);
    assert.doesNotMatch(
      stochasticReflectionShader(contractLightingShader(bounce, false), true),
      /fn reflectionHiZWalk/,
    );
  }
});

test('the filtered reflection is the rough branch of the full one, without its proxy ray', () => {
  const bounced = stochasticReflectionShader(contractLightingShader(true, false));
  const [filtered, full] = [
    functionsOf(bounced, ['filteredReflectedRadiance']),
    functionsOf(bounced, ['reflectedRadiance']),
  ];
  assert.doesNotMatch(filtered, /proxyReflectionRay/);
  assert.match(full, /if\(weight==0\.0\)\{return filtered;\}/);
  for (const line of [
    'if(bounce.counts.w==0u){return environmentReflection(R,rough);}',
    'filteredProbeReflection(P,N,R,rough)',
  ]) {
    assert.ok(filtered.includes(line) && full.includes(line), line);
  }
});
