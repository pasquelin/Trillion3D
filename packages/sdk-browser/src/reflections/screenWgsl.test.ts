import test from 'node:test';
import assert from 'node:assert/strict';
import { BOUNDED_SCREEN_REFLECTION_WGSL, withScreenReflections } from './screenWgsl.ts';
import { MIRROR_TRANSITION_END } from './modelShader.ts';
import { REFLECTION_SOURCE_WGSL } from './sourceWgsl.ts';
import { ENVIRONMENT, FILTERED, RAY, resolvedDisplay } from './receivers.fixture.ts';
import { functionText } from '../bounce/wgslBody.fixture.ts';
import { DIRECT_LIGHTING_SHADER } from '../gpu/core/shaderTexts.fixture.ts';

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

test('the water mirror walks the depth bounds; a miss reads the filtered probes, no proxy ray', () => {
  const read = (hit: boolean) => {
    let walks = 0,
      filteredAt: number | undefined;
    const { calls, at } = resolvedDisplay({
      shader: BOUNDED_SCREEN_REFLECTION_WGSL,
      functions: ['boundedReflectionRay'],
      globals: {
        shadowFootprint: 0,
        screenReflectionHiZ: () => (walks++, hit ? [...RAY, 1] : [0, 0, 0, 0]),
        filteredReflectedRadiance: (...args: number[]) => ((filteredAt = args[3]), FILTERED),
      },
    });
    const value = at(0);
    return { value, walks, fullWalks: calls.traced, fallback: calls.fallback, filteredAt };
  };
  const none = { walks: 1, fullWalks: 0, fallback: 0 };
  assert.deepEqual(read(true), { ...none, value: RAY, filteredAt: undefined });
  assert.deepEqual(read(false), {
    ...none,
    value: FILTERED,
    filteredAt: Number(MIRROR_TRANSITION_END),
  });
});
