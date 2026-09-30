import test from 'node:test';
import assert from 'node:assert/strict';
import { withScreenReflections } from './screenWgsl.ts';
import { REFLECTION_SOURCE_WGSL } from './source.ts';
import { ENVIRONMENT, FILTERED, RAY, resolvedDisplay } from './receivers.fixture.ts';
import { DIRECT_LIGHTING_SHADER } from '../lighting/deferred/shaders.ts';
import { functionText } from '../bounce/wgslBody.fixture.ts';

test('a screen hit replaces the fallback; a miss or a disabled pass reads it, once', () => {
  const read = (options: Parameters<typeof resolvedDisplay>[0], rough: number) => {
    const { calls, at } = resolvedDisplay(options);
    return { value: at(rough), fallback: calls.fallback };
  };
  assert.deepEqual(read({}, 0), { value: RAY, fallback: 0 });
  assert.deepEqual(read({ hit: false }, 0), { value: ENVIRONMENT, fallback: 1 });
  assert.deepEqual(read({ enabled: 0 }, 0), { value: ENVIRONMENT, fallback: 1 });
  assert.deepEqual(read({}, 0.2), { value: FILTERED, fallback: 0 });
  assert.deepEqual(read({ hit: false }, 0.2), { value: ENVIRONMENT, fallback: 1 });
  assert.deepEqual(read({ weight: () => 0.5 }, 0.2), { value: [6, 6, 6], fallback: 0 });
  // In the roughness fade one read serves both the lobe share the trace left and the fade.
  assert.deepEqual(read({}, 0.45), { value: [4, 4, 4], fallback: 1 });
  assert.deepEqual(read({ hit: false }, 0.45), { value: ENVIRONMENT, fallback: 1 });
});

test('the source reprojects the last lit image and lights nothing itself', () => {
  const body = functionText(REFLECTION_SOURCE_WGSL, 'reprojectReflectionSource');
  assert.match(body, /previousUv\(/);
  assert.doesNotMatch(REFLECTION_SOURCE_WGSL, /lightSurface|mirrorLighting|bounceLighting|fogged/);
});

test('the final direct resolve adds screen reflections over the environment, with no proxy', () => {
  const shader = withScreenReflections(DIRECT_LIGHTING_SHADER, true);
  assert.match(functionText(shader, 'lightSurface'), /mirrorLighting/);
  assert.match(functionText(shader, 'mirrorLighting'), /resolvedRadiance/);
  assert.match(
    functionText(shader, 'reflectedRadiance'),
    /return environmentReflection\(R,rough\)/,
  );
  assert.doesNotMatch(shader, /rayRadiance/);
});
