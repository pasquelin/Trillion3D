import test from 'node:test';
import assert from 'node:assert/strict';
import { SCREEN_REFLECTION_WGSL, reflectionSource, withScreenReflections } from './screenWgsl.ts';
import { functionText } from '../bounce/wgslBody.fixture.ts';
import { contractLightingShader } from '../lighting/deferred/shaders.ts';

const BOUNCE_LIGHTING_SHADER = contractLightingShader(true, false);
const DIRECT_LIGHTING_SHADER = contractLightingShader(false, false);

const text = functionText(SCREEN_REFLECTION_WGSL, 'resolvedRadiance');
const ray = functionText(SCREEN_REFLECTION_WGSL, 'resolvedReflectionRay');
const resolved = new Function(`
 const vec3f=x=>x,mix=(a,b,t)=>a*(1-t)+b*t;
 return (enabled,hit,weight)=>{
  let fallbackCalls=0;
  const reflectionView={enabled:{x:enabled?1:0}},mirrorWeight=()=>weight;
  const screenReflection=()=>({a:hit?1:0,rgb:7});
  const reflectedRadiance=()=>{fallbackCalls++;return 3;};
  function resolvedReflectionRay(P,N,R){${ray.slice(ray.indexOf('{') + 1)}}
  const filteredResolvedReflection=(P,N,R)=>resolvedReflectionRay(P,N,R);
  function resolvedRadiance(P,N,R,rough){${text.slice(text.indexOf('{') + 1)}}
  return {value:resolvedRadiance(0,0,0,0),fallbackCalls};
 };`)() as (
  enabled: boolean,
  hit: boolean,
  weight: number,
) => { value: number; fallbackCalls: number };

test('a screen hit replaces proxy radiance; misses and disabled sources keep the proxy unchanged', () => {
  assert.deepEqual(resolved(true, true, 1), { value: 7, fallbackCalls: 0 });
  assert.deepEqual(resolved(true, false, 1), { value: 3, fallbackCalls: 1 });
  assert.deepEqual(resolved(false, true, 1), { value: 3, fallbackCalls: 1 });
  assert.deepEqual(resolved(true, true, 0), { value: 7, fallbackCalls: 0 });
  assert.deepEqual(resolved(true, true, 0.5), { value: 7, fallbackCalls: 0 });
  assert.deepEqual(resolved(true, false, 0), { value: 3, fallbackCalls: 1 });
});

test('frozen source excludes mirror recursion and camera fog without dropping bounced diffuse light', () => {
  const body = functionText(reflectionSource(BOUNCE_LIGHTING_SHADER), 'lightSurface');
  assert.doesNotMatch(body, /mirrorLighting|fogged/);
  assert.match(body, /bounceLighting/);
});

test('the final direct resolve adds screen reflections independently of proxy resources', () => {
  const shader = withScreenReflections(DIRECT_LIGHTING_SHADER, true);
  assert.match(functionText(shader, 'lightSurface'), /mirrorLighting/);
  assert.match(functionText(shader, 'mirrorLighting'), /resolvedRadiance/);
  assert.match(functionText(shader, 'reflectedRadiance'), /return vec3f\(0.0\)/);
});
