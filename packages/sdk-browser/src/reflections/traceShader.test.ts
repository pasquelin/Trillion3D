import test from 'node:test';
import assert from 'node:assert/strict';
import { screenTraceShader } from './traceShader.ts';

// Execute the production DDA after its projection, translating only vector constructors,
// comparisons and declarations. Bounds and depth intervals remain the emitted shader text.
const shader = screenTraceShader('wgsl');
const loop = shader
  .slice(shader.indexOf(' var pixel:'), shader.lastIndexOf('\n}'))
  .replace(/var (\w+):\w+/g, 'let $1')
  .replace('origin=pixel', 'origin=vec2i(pixel)')
  .replace('any(pixel<vec2i(0))', '(pixel.x<0||pixel.y<0)')
  .replace('any(pixel>=vec2i(size))', '(pixel.x>=size.x||pixel.y>=size.y)')
  .replace('all(pixel==origin)', '(pixel.x===origin.x&&pixel.y===origin.y)');
const trace = new Function(`
 const vec2i=v=>typeof v==='number'?{x:v,y:v}:{...v},vec2f=vec2i;
 const floor=v=>({x:Math.floor(v.x),y:Math.floor(v.y)}),i32=Math.trunc,f32=Number;
 const min=Math.min,max=Math.max,mix=(a,b,t)=>a+(b-a)*t;
 const vec4f=()=>null;
 return (start,delta,a,b,size,depth)=>{
  const reflectionDepthAt=p=>depth(p.x,p.y),reflectionClearDepth=()=>0;
  const reflectionHitAt=p=>[p.x,p.y];
  ${loop}
 };`)() as (
  start: { x: number; y: number },
  delta: { x: number; y: number },
  a: { z: number },
  b: { z: number },
  size: { x: number; y: number },
  depth: (x: number, y: number) => number,
) => number[] | null;

test('subpixel ray entries test the entire thin-geometry pixel interval in both directions', () => {
  // x=2.05 belongs to pixel 2: midpoint stepping previously assigned it to pixel 1.
  for (const [start, delta, x] of [
    [0.1, 5, 2.05],
    [5.9, -5, 3.95],
  ]) {
    const z = 0.8 - ((x - start) / delta) * 0.6,
      pixel = Math.floor(x);
    assert.deepEqual(
      trace(
        { x: start, y: 1.2 },
        { x: delta, y: 0 },
        { z: 0.8 },
        { z: 0.2 },
        { x: 8, y: 4 },
        (px, py) => (px === pixel && py === 1 ? z : 0),
      ),
      [pixel, 1],
    );
  }
});

test('diagonal crossings cover each occupied cell and respect the frozen screen bounds', () => {
  const start = { x: 0.1, y: 0.2 },
    delta = { x: 6.7, y: 4.2 },
    size = { x: 8, y: 6 };
  for (let i = 1; i < 50; i++) {
    const t = i / 50,
      x = Math.floor(start.x + delta.x * t),
      y = Math.floor(start.y + delta.y * t);
    if (x === 0 && y === 0) continue;
    assert.deepEqual(
      trace(start, delta, { z: 0.9 }, { z: 0.1 }, size, (px, py) =>
        px === x && py === y ? 0.9 - 0.8 * t : 0,
      ),
      [x, y],
    );
  }
  assert.equal(
    trace(start, delta, { z: 0.9 }, { z: 0.1 }, size, () => 0),
    null,
  );
  assert.equal(
    trace(start, { x: 0, y: 0 }, { z: 0.9 }, { z: 0.1 }, size, () => 0.5),
    null,
  );
});
