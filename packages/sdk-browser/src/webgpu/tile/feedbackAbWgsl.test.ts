import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SHADE_SHADER } from '../../visibility/buffer.ts';
import { WATER_SURFACE_WGSL } from '../water/surfaceWgsl.ts';
import { feedbackFreeEntry } from './feedbackAbWgsl.ts';
import { blendShader } from '../blend/shader.ts';

const BLEND_SHADER = blendShader();

test('target-free opaque resolve projects the same four surface outputs', () => {
  const code = feedbackFreeEntry(
    SHADE_SHADER,
    'shade_fs',
    'SurfaceOut',
    [
      ['baseMetal', 'vec4f'],
      ['normalRough', 'vec4f'],
      ['emissiveAo', 'vec4f'],
      ['flags', 'u32'],
    ],
    '@builtin(position) pos:vec4f',
    'pos',
  );
  assert.match(code, /fn shade_fsSource\(pos:vec4f\)->SurfaceOut/);
  assert.match(code, /@fragment fn shade_fsWithoutFeedback/);
  assert.match(code, /struct SurfaceOutWithoutFeedback\{@location\(0\).*@location\(3\)/s);
  assert.doesNotMatch(code, /struct SurfaceOutWithoutFeedback\{[^}]*@location\(4\)/);
  assert.match(
    code,
    /return SurfaceOutWithoutFeedback\(result\.baseMetal,result\.normalRough,result\.emissiveAo,result\.flags\)/,
  );
});

test('target-free transparent and water entries keep their color outputs', () => {
  const blend = feedbackFreeEntry(
    BLEND_SHADER + WATER_SURFACE_WGSL,
    'fs',
    'BlendOut',
    [['color', 'vec4f']],
    'in:VSOut,@builtin(front_facing) front:bool',
    'in,front',
  );
  const code = feedbackFreeEntry(
    blend,
    'fsWater',
    'WaterOut',
    [
      ['baseMetal', 'vec4f'],
      ['normalRough', 'vec4f'],
      ['emissiveAo', 'vec4f'],
      ['word', 'vec4f'],
    ],
    'in:VSOut,@builtin(front_facing) front:bool',
    'in,front',
  );
  assert.match(code, /@fragment fn fsWithoutFeedback/);
  assert.match(code, /@fragment fn fsWaterWithoutFeedback/);
  assert.doesNotMatch(code, /struct BlendOutWithoutFeedback\{[^}]*@location\(1\)/);
  assert.doesNotMatch(code, /struct WaterOutWithoutFeedback\{[^}]*@location\(4\)/);
});
