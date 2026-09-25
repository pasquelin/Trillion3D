// A module with a name it declares nowhere compiles on no device: the measurer's browser would
// be the first to see it (#348, `unresolved value 'uni'` in the cluster decoding proof). This Node
// test reads every text the engine compiles, and the proof that decodes through the page
// geometry, before any browser does.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ENGINE_SHADERS } from './engineShaders.fixture.ts';
import { unresolvedNames } from './wgslNames.fixture.ts';
import { SHADOW_DEPTH_SHADER } from '../shadow/shader.ts';
import { PAGE_BINDING } from '../../visibility/shader/pageWgsl.ts';
import { CLUSTER_DECODING_SHADER } from '../../../../../tests/browser/probes/clusterDecodingGpu.ts';

const unresolved = (shaders: Record<string, string>) =>
  Object.fromEntries(
    Object.entries(shaders)
      .map(([name, code]) => [name, unresolvedNames(code)] as const)
      .filter(([, names]) => names.length),
  );

test('every WGSL text the engine compiles resolves every name it uses', () => {
  assert.ok(Object.keys(ENGINE_SHADERS).length >= 40, 'the list holds every module');
  assert.deepEqual(unresolved(ENGINE_SHADERS), {});
});

test('the cluster decoding proof declares the camera uniform the page geometry reads', () => {
  assert.deepEqual(unresolvedNames(CLUSTER_DECODING_SHADER), []);
});

test('a pass that includes the page geometry without its camera uniform leaves `uni` unresolved', () => {
  assert.ok(SHADOW_DEPTH_SHADER.includes(PAGE_BINDING.uniforms));
  const withoutCamera = SHADOW_DEPTH_SHADER.replace(PAGE_BINDING.uniforms, '');
  assert.deepEqual(unresolvedNames(withoutCamera), ['uni']);
});

test('a comment, an attribute, a structure member or a field after a dot is never a name', () => {
  const code = `struct S{uni:f32,}
/** uni.viewport */ // uni
@group(0) @binding(0) var<uniform> s:S;
@compute @workgroup_size(1) fn main(@builtin(global_invocation_id) id:vec3u){let v=s.uni+f32(id.x);}`;
  assert.deepEqual(unresolvedNames(code), []);
  assert.deepEqual(unresolvedNames(code.replace('var<uniform> s:S', 'var<uniform> t:S')), ['s']);
});
