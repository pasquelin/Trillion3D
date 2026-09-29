import test from 'node:test';
import assert from 'node:assert/strict';
import { SCREEN_REFLECTION_GLSL } from './screenGlsl.ts';
import { CLUSTER_FRAGMENT } from '../webgl/cluster/shaders.ts';

test('a resolved mirror samples the reduced image instead of tracing a second time', () => {
  assert.match(
    SCREEN_REFLECTION_GLSL,
    /uniform sampler2D reflectionColor,reflectionDepth,reflectionResolveImage;/,
  );
  assert.match(
    SCREEN_REFLECTION_GLSL,
    /if\(reflectionResolve\)return texture\(reflectionResolveImage,gl_FragCoord\.xy\/vec2\(textureSize\(reflectionResolveImage,0\)\)\)\.rgb;/,
  );
  assert.match(SCREEN_REFLECTION_GLSL, /return screenReflection\(P,R\)\.rgb;/);
});

test('the cluster program traces once in its resolve pass and shades the display otherwise', () => {
  const trace = CLUSTER_FRAGMENT.indexOf(
    'if(reflectionOutput)rgb=reflectedRadiance(viewPosition,N,reflect(-V,N),rough);',
  );
  const curve = CLUSTER_FRAGMENT.indexOf('if(toneMapped)rgb=toneMap(rgb)');
  assert.ok(trace > 0 && trace < curve, 'the single trace is written before the display curve');
  assert.match(CLUSTER_FRAGMENT, /if\(lit&&!reflectionOutput\)rgb\+=mirrorLighting/);
  assert.match(CLUSTER_FRAGMENT, /if\(transmissive&&!reflectionOutput\)\{/);
  assert.match(
    CLUSTER_FRAGMENT,
    /if\(!fogFree&&!reflectionCapture&&!reflectionOutput\)rgb=fogged\(rgb\);/,
  );
});
