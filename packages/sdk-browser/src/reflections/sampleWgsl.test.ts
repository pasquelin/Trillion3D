import test from 'node:test';
import assert from 'node:assert/strict';
import { stochasticReflectionShader } from './sampleWgsl.ts';
import { contractLightingShader } from '../lighting/deferred/shaders.ts';
import { functionsOf } from '../texture/shaderRule.fixture.ts';
import { MIRROR_TRANSITION_END } from './modelShader.ts';
import { withSubgroupShadowRequests } from '../lighting/direct/shadowRequestWgsl.ts';

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

/** The functions `entry` reaches in `source`, itself included. */
function reached(source: string, entry: string) {
  const declared = new Set([...source.matchAll(/fn (\w+)\(/g)].map((match) => match[1]));
  const seen = new Set<string>();
  for (const stack = [entry]; stack.length;) {
    const name = stack.pop()!;
    if (seen.has(name)) continue;
    seen.add(name);
    const body = functionsOf(source, [name]).replace(/^[^{]*\{/, '');
    for (const [, called] of body.matchAll(/(\w+)\(/g))
      if (declared.has(called)) stack.push(called);
  }
  return seen;
}

test('#1346: the rough trace asks no shadow page, so none of its own lands to restart the TAA history', () => {
  for (const bounce of [false, true])
    for (const unbounded of [false, true])
      for (const subgroup of [false, true]) {
        const lighting = contractLightingShader(bounce, false);
        const shader = stochasticReflectionShader(
          subgroup ? withSubgroupShadowRequests(lighting) : lighting,
          unbounded,
        );
        const calls = reached(shader, 'traceRoughReflection');
        assert.ok(calls.has('stochasticReflection'), 'the closure follows the calls');
        for (const asks of ['requestShadowPage', 'shadowClaimPage'])
          assert.ok(
            !calls.has(asks),
            `${asks} from the trace (${bounce}, ${unbounded}, ${subgroup})`,
          );
        assert.doesNotMatch(functionsOf(shader, ['traceRoughReflection']), /shadowRequesting/);
      }
});
