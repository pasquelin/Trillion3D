import test from 'node:test';
import assert from 'node:assert/strict';
import { WATER_SURFACE_WGSL } from '../water/surfaceWgsl.ts';
import { blendShader } from './shader.ts';

const BLEND_SHADER = blendShader();

test('the blend module runs the facing test and discards on front_facing', () => {
  assert.match(BLEND_SHADER, /fn vertexFacing\(/);
  assert.match(BLEND_SHADER, /facingDiscarded\(in\.water>>16u,front\)/);
  assert.doesNotMatch(BLEND_SHADER, /fn vertexCulled\(/, 'one facing test, not two');
  assert.match(
    WATER_SURFACE_WGSL,
    /\(in\.water&65535u\)/,
    'the water rank stored without the mode',
  );
});
