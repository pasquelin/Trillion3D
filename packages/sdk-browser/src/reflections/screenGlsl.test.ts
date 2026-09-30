import test from 'node:test';
import assert from 'node:assert/strict';
import { WEBGL_SCREEN_RADIANCE } from './webglScreenRadiance.ts';
import { screenRadianceShader } from './screenRadianceShader.ts';
import { environmentReflectionShader } from './environmentShader.ts';
import { ENVIRONMENT_REFLECTION_WGSL } from './probeFilterWgsl.ts';
import { SCREEN_REFLECTION_CUTOFF as CUTOFF } from './modelShader.ts';
import { ENVIRONMENT, FILTERED, RAY, resolvedDisplay } from './receivers.fixture.ts';
import { CLUSTER_FRAGMENT } from '../webgl/cluster/shaders.ts';
import { PROBE_ENVIRONMENT } from '../webgl/cluster/probeEnvironment.ts';
import { shaderRun } from '../texture/shaderRun.fixture.ts';

const RESOLVED = [9, 9, 9];

/** The WebGL2 resolve, written once for both languages, run in its WGSL spelling. */
const webglDisplay = ({ enabled = true, hit = true, capture = false, resolve = false } = {}) =>
  resolvedDisplay({
    hit,
    weight: (rough: number) => +(rough < 0.1),
    shader: screenRadianceShader('wgsl', WEBGL_SCREEN_RADIANCE),
    entry: 'reflectedRadiance',
    fallback: 'environmentReflection',
    globals: {
      reflectionEnabled: enabled,
      reflectionCapture: capture,
      reflectionResolve: resolve,
      texture: () => [...RESOLVED, 1],
      textureSize: () => [1, 1],
      gl_FragCoord: [0, 0, 0, 0],
      reflectionColor: 'reduced',
    },
  });

test('WebGL2: a miss, a disabled pass or a rough lobe reads the environment probe, never black', () => {
  const traced = webglDisplay();
  assert.deepEqual(traced.at(0), RAY, 'a mirror keeps its exact ray');
  assert.deepEqual(traced.at(0.2), FILTERED, 'polished metal keeps its screen trace');
  assert.deepEqual(traced.at((3 * CUTOFF) / 4), [4, 4, 4], 'the fade blends toward the probe');
  traced.calls.traced = 0;
  for (const rough of [CUTOFF, 1])
    assert.deepEqual(traced.at(rough), ENVIRONMENT, `rough ${rough}`);
  assert.equal(traced.calls.traced, 0, 'no trace past the cutoff');
  for (const rough of [0, 0.2]) {
    assert.deepEqual(webglDisplay({ hit: false }).at(rough), ENVIRONMENT, `a miss at ${rough}`);
    assert.deepEqual(
      webglDisplay({ enabled: false }).at(rough),
      ENVIRONMENT,
      `no pass at ${rough}`,
    );
  }
  assert.deepEqual(webglDisplay({ capture: true }).at(0), [0, 0, 0], 'the source holds no mirror');
  assert.deepEqual(webglDisplay({ resolve: true }).at(0), RESOLVED, 'a mirror reads its resolve');
});

test('WebGL2 reflects the probe coefficients as WebGPU reflects its environment', () => {
  // Brighter overhead: a constant and a `y` term, as three-component coefficients on WebGL2.
  const sh = [[2, 2, 2], [1, 1, 1], ...Array.from({ length: 7 }, () => [0, 0, 0])];
  const names = ['reflectionProbeBands', 'environmentReflection'];
  type Program = { environmentReflection: (R: number[], rough: number) => number[] };
  // The identity rotation: the view is the world.
  const webgl = shaderRun<Program>(environmentReflectionShader('wgsl', PROBE_ENVIRONMENT), names, {
    probeSh: sh,
    viewRotation: 1,
  });
  const webgpu = shaderRun<Program>(ENVIRONMENT_REFLECTION_WGSL, names, {
    directLights: { environment: sh.map((c) => [...c, 0]) },
  });
  for (const rough of [0.05, 0.3, 1]) {
    const up = webgl.environmentReflection([0, 1, 0], rough);
    assert.deepEqual(up, webgpu.environmentReflection([0, 1, 0], rough));
    assert.ok(up[0] > 0, `rough ${rough}: never black under a lit sky`);
  }
  const dark = shaderRun<Program>(environmentReflectionShader('wgsl', PROBE_ENVIRONMENT), names, {
    probeSh: sh.map(() => [0, 0, 0]),
    viewRotation: 1,
  });
  assert.deepEqual(dark.environmentReflection([0, 1, 0], 0.5), [0, 0, 0]);
  // Declared before the resolve that falls back on it: GLSL reads top to bottom.
  const declared = CLUSTER_FRAGMENT.indexOf('vec3 environmentReflection(');
  assert.ok(declared > 0 && declared < CLUSTER_FRAGMENT.indexOf('vec3 reflectedRadiance('));
});

test('the cluster program traces once in its resolve pass and shades the display otherwise', () => {
  const trace = CLUSTER_FRAGMENT.indexOf(
    'if(reflectionOutput)rgb=reflectedRadiance(viewPosition,N,reflect(-V,N),rough);',
  );
  const curve = CLUSTER_FRAGMENT.indexOf('if(toneMapped)rgb=toneMap(rgb)');
  assert.ok(trace > 0 && trace < curve, 'the single trace is written before the display curve');
  assert.match(CLUSTER_FRAGMENT, /if\(lit&&!reflectionOutput\)/);
  assert.match(CLUSTER_FRAGMENT, /if\(transmissive&&!reflectionOutput\)\{/);
  assert.match(
    CLUSTER_FRAGMENT,
    /if\(!fogFree&&!reflectionCapture&&!reflectionOutput\)rgb=fogged\(rgb\);/,
  );
});
