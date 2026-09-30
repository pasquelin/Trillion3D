import test from 'node:test';
import assert from 'node:assert/strict';
import { ROUGH_TRACE_READS, ROUGH_TRACE_WGSL } from './boundedTraceWgsl.ts';
import { functionsOf } from '../texture/shaderRule.fixture.ts';

// Execute the shipped march, translating only vector constructors, comparisons and declarations.
const march = functionsOf(ROUGH_TRACE_WGSL, ['roughMarch'])
  .replace(/^fn roughMarch\([^)]*\)->vec4f\{/, '')
  .replace(/\}$/, '')
  .replace(/\b(?:let|var) (\w+)(?::\w+)?=/g, 'let $1=')
  .replace('any(pixel<vec2i(0))||any(pixel>=vec2i(size))', 'outside(pixel)')
  .replace('!all(pixel==origin)', '!(pixel.x===origin.x&&pixel.y===origin.y)')
  .replace('start+delta*exited', 'add(start,delta,exited)');
const run = new Function(`
 const vec2i=v=>({x:Math.trunc(v.x),y:Math.trunc(v.y)}),floor=v=>({x:Math.floor(v.x),y:Math.floor(v.y)});
 const f32=Number,min=Math.min,max=Math.max,ceil=Math.ceil,abs=Math.abs;
 const clamp=(v,lo,hi)=>min(max(v,lo),hi),mix=(a,b,t)=>a+(b-a)*t;
 const add=(s,d,t)=>({x:s.x+d.x*t,y:s.y+d.y*t});
 const vec4f=(color,hit)=>hit===undefined?null:color;
 return (start,delta,za,zb,size,jitter,depth)=>{
  const outside=p=>p.x<0||p.y<0||p.x>=size.x||p.y>=size.y;
  let reads=0;
  const reflectionDepthAt=p=>(reads++,depth(p.x,p.y)),reflectionClearDepth=()=>0;
  const reflectionColorAt=p=>[p.x,p.y];
  const hit=(()=>{${march}})();
  return {hit,reads};
 };`)() as (
  start: { x: number; y: number },
  delta: { x: number; y: number },
  za: number,
  zb: number,
  size: { x: number; y: number },
  jitter: number,
  depth: (x: number, y: number) => number,
) => { hit: number[] | null; reads: number };

test('a rough ray reads a fixed budget, however long its projected segment', () => {
  const size = { x: 4096, y: 4096 };
  for (const length of [3, 40, 4000]) {
    const { hit, reads } = run(
      { x: 1.5, y: 1.5 },
      { x: length, y: 0 },
      0.9,
      0.1,
      size,
      1,
      () => 0.95,
    );
    assert.equal(hit, null);
    assert.ok(reads <= ROUGH_TRACE_READS, `${length} pixels: ${reads} reads`);
  }
});

test('a short segment reads one pixel each, and a surface inside the ray interval answers', () => {
  // Pixel 5 holds a surface at the depth the ray crosses between its reads.
  const z = (x: number) => 0.9 - ((x - 1.5) / 8) * 0.8;
  const { hit } = run({ x: 1.5, y: 1.5 }, { x: 8, y: 0 }, 0.9, 0.1, { x: 16, y: 4 }, 1, (x, y) =>
    x === 5 && y === 1 ? z(5.5) : 0,
  );
  assert.deepEqual(hit, [5, 1]);
});

test('a long segment still finds a surface its interval brackets, and never leaves the screen', () => {
  const size = { x: 2048, y: 8 };
  const { hit } = run({ x: 0.5, y: 4.5 }, { x: 2000, y: 0 }, 0.9, 0.1, size, 0.5, (x) =>
    x >= 1000 ? 0.5 : 0.95,
  );
  assert.ok(hit && hit[0] >= 1000, 'the first read past the step answers');
  const { hit: left, reads } = run(
    { x: 0.5, y: 4.5 },
    { x: -2000, y: 0 },
    0.9,
    0.1,
    size,
    1,
    () => 0.5,
  );
  assert.equal(left, null);
  assert.equal(reads, 0);
});
