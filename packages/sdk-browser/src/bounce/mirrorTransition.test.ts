import test from 'node:test';
import assert from 'node:assert/strict';
import { BOUNCE_LIGHTING_SHADER } from '../lighting/deferred/shaders.ts';
import { ROUGHNESS_FLOOR } from '../lighting/shaderConstants.ts';
import { MIRROR_TRANSITION_END } from './reflectWgsl.ts';
import { fromHalf, toHalf } from '../../../sdk-core/src/lighting/ltcTable.ts';
import { functionText } from './wgslBody.fixture.ts';

// Execute the generated shader, component-wise with unit Fresnel. Vector-only operations
// have controlled inputs; the roughness branches and interpolation are the production text.
const scalarBody = (name: string) => {
  const text = functionText(BOUNCE_LIGHTING_SHADER, name);
  return text
    .slice(text.indexOf('{') + 1)
    .replace(/\b(\d+)u\b/g, '$1')
    .replace(/var (\w+):\w+/g, 'let $1');
};
const evaluate = new Function(`
 const clamp=(x,a,b)=>Math.max(a,Math.min(b,x)), vec3f=x=>x;
 const smoothstep=(a,b,x)=>{const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};
 const mix=(a,b,t)=>a*(1-t)+b*t, dot=()=>1, reflect=x=>x;
 const ltcLookup=()=>({x:1,y:0}), INVERSE_PI=1/Math.PI;
 const proxy={offsetMetres:0,startMetres:0};
 function mirrorWeight(rough){${scalarBody('mirrorWeight')}}
 return (rough,surfaceModel=0,enabled=true,hit=true)=>{
  let rays=0;
  const bounce={counts:{w:enabled?1:0},reach:{x:10}};
  const rayRadiance=()=>{rays++;return {rgb:1,w:hit?1:10};};
  const sampleBounce=()=>enabled?Math.PI/4:0;
  function reflectedRadiance(P,N,R,rough){${scalarBody('reflectedRadiance')}}
  function mirrorLighting(rgb,metal,rough,N,V,P){${scalarBody('mirrorLighting')}}
  const mirror=mirrorLighting(1,1,rough,1,1,0), mirrorRays=rays;
  const water=reflectedRadiance(0,1,1,rough);
  return {mirror,water,mirrorRays,waterRays:rays-mirrorRays};
 };`)() as (
  rough: number,
  model?: number,
  enabled?: boolean,
  hit?: boolean,
) => { mirror: number; water: number; mirrorRays: number; waterRays: number };

test('mirror and water retain floor energy and cross the threshold continuously', () => {
  const floor = Number(ROUGHNESS_FLOOR),
    end = Number(MIRROR_TRANSITION_END);
  assert.equal(evaluate(floor).mirror, 1);
  assert.equal(evaluate(floor).water, 1);
  assert.deepEqual(evaluate(floor - 1e-4), evaluate(floor));
  assert.equal(evaluate(fromHalf(toHalf(floor))).mirror, 1);
  assert.ok(evaluate(fromHalf(toHalf(floor) + 1)).mirror > 0.999);
  assert.ok(Math.abs(evaluate((floor + end) / 2).mirror - 0.5) < 1e-12);
  assert.ok(Math.abs(evaluate((floor + end) / 2).water - 0.625) < 1e-12);
  for (const epsilon of [1e-4, 1e-6, 1e-8]) {
    assert.ok(evaluate(floor + epsilon).mirror > 0.999);
    assert.ok(evaluate(floor + epsilon).water > 0.999);
    assert.ok(evaluate(end - epsilon).mirror < 0.001);
    assert.ok(Math.abs(evaluate(end - epsilon).water - 0.25) < 0.001);
  }
  let previous = evaluate(floor);
  for (let i = 1; i <= 64; i++) {
    const current = evaluate(floor + ((end - floor) * i) / 64);
    assert.ok(current.mirror <= previous.mirror && current.mirror >= 0);
    assert.ok(current.water <= previous.water && current.water >= 0.25);
    previous = current;
  }
  assert.deepEqual(evaluate(end), { mirror: 0, water: 0.25, mirrorRays: 0, waterRays: 0 });
  assert.deepEqual(evaluate(1), evaluate(end));
});

test('diffuse/toon, disabled bounce and proxy misses retain their reflection contracts', () => {
  const floor = Number(ROUGHNESS_FLOOR),
    end = Number(MIRROR_TRANSITION_END);
  for (const rough of [floor, floor + 1e-4, (floor + end) / 2, end, 1]) {
    for (const model of [4, 5]) {
      assert.equal(evaluate(rough, model).mirror, 0);
      assert.equal(evaluate(rough, model).mirrorRays, 0);
    }
    assert.deepEqual(evaluate(rough, 0, false), {
      mirror: 0,
      water: 0,
      mirrorRays: 0,
      waterRays: 0,
    });
    assert.equal(evaluate(rough, 0, true, false).water, 0.25);
  }
});
