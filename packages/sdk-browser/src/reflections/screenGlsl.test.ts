import test from 'node:test';
import assert from 'node:assert/strict';
import { SCREEN_REFLECTION_GLSL } from './screenGlsl.ts';
import { CLUSTER_FRAGMENT } from '../webgl/cluster/shaders.ts';

test('a resolved mirror samples the reduced image on the source unit instead of tracing again', () => {
  assert.match(
    SCREEN_REFLECTION_GLSL,
    /uniform bool reflectionEnabled,reflectionCapture,reflectionResolve,reflectionOutput;/,
  );
  assert.match(
    SCREEN_REFLECTION_GLSL,
    /if\(reflectionResolve&&mirrorWeight\(rough\)>0\.0\)return texture\(reflectionColor,gl_FragCoord\.xy\/vec2\(textureSize\(reflectionColor,0\)\)\)\.rgb;/,
  );
  assert.match(
    SCREEN_REFLECTION_GLSL,
    /return mix\(filtered,screenReflectionRay\(P,N,R\),weight\);/,
  );
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
