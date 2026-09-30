import test from 'node:test';
import assert from 'node:assert/strict';
import { HIZ_TRACE_WGSL } from './hizTraceWgsl.ts';
import { functionText } from '../bounce/wgslBody.fixture.ts';

// Runs the production walk's own text: only declarations and constructors are translated.
const HIZ_WALK = functionText(HIZ_TRACE_WGSL, 'reflectionHiZWalk');
/** The step cap, as the walk's loop reads it. */
const REFLECTION_TRACE_STEPS = Number(/i<(\d+);/.exec(HIZ_WALK)![1]);
const body = HIZ_WALK.slice(HIZ_WALK.indexOf('{\n') + 1)
  .replace(/(?:var|let) (\w+):\w+=/g, 'let $1=')
  .replace(/range\.x/g, 'range[0]')
  .replace(/range\.y/g, 'range[1]');
type Bounds = (x: number, y: number, level: number) => [number, number];
const walk = new Function(`
 const i32=Math.trunc,f32=Number,floor=Math.floor,sign=Math.sign,exp2=(v)=>2**v;
 const min=Math.min,max=Math.max,mix=(a,b,t)=>a+(b-a)*t;
 const vec2i=(x,y)=>({x,y}),vec4f=()=>null;
 return (start,delta,za,zb,size,levels,bounds)=>{
  const reflectionBounds=null,textureNumLevels=()=>levels;
  const reflectionBoundsAt=(p,level)=>bounds(p.x,p.y,level);
  const reflectionHitAt=(p)=>[p.x,p.y];
  ${body}
 };`)() as (
  start: { x: number; y: number },
  delta: { x: number; y: number },
  za: number,
  zb: number,
  size: { x: number; y: number },
  top: number,
  bounds: Bounds,
) => number[] | null;

/** Nearest/farthest of a depth image over each pyramid cell, clear depth (0) holding no range. */
function pyramid(width: number, height: number, depth: (x: number, y: number) => number) {
  const levels: number[] = [];
  const bounds: Bounds = (cx, cy, level) => {
    levels.push(level);
    const side = 2 ** level;
    let lo = 1,
      hi = 0;
    for (let y = cy * side; y < Math.min(height, (cy + 1) * side); y++)
      for (let x = cx * side; x < Math.min(width, (cx + 1) * side); x++) {
        const z = depth(x, y);
        if (z === 0) continue;
        lo = Math.min(lo, z);
        hi = Math.max(hi, z);
      }
    return [lo, hi];
  };
  return { bounds, levels };
}

test('the walk climbs the Hi-Z levels over empty cells and finds the pixel a full walk would', () => {
  const size = { x: 256, y: 4 };
  const start = { x: 0.5, y: 1.5 },
    delta = { x: 240, y: 0 };
  const hitX = 200,
    zAt = (x: number) => 0.9 - ((x + 0.5 - start.x) / delta.x) * 0.8;
  const { bounds, levels } = pyramid(size.x, size.y, (x, y) =>
    x === hitX && y === 1 ? zAt(x) : 0,
  );
  assert.deepEqual(walk(start, delta, 0.9, 0.1, size, 8, bounds), [hitX, 1]);
  assert.ok(Math.max(...levels) >= 4, 'coarse cells are skipped whole');
  assert.ok(levels.length < hitX / 4, `${levels.length} steps, not one per pixel`);
});

test('the receiver pixel never answers and an empty screen is a miss', () => {
  const { bounds } = pyramid(64, 64, () => 0.5);
  assert.equal(
    walk({ x: 10.5, y: 10.5 }, { x: 0, y: 0 }, 0.5, 0.5, { x: 64, y: 64 }, 6, bounds),
    null,
  );
  const empty = pyramid(64, 64, () => 0);
  assert.equal(
    walk({ x: 1.5, y: 1.5 }, { x: 60, y: 50 }, 0.9, 0.1, { x: 64, y: 64 }, 6, empty.bounds),
    null,
  );
});

test('a ray the pyramid keeps descending stops at the step cap, a miss', () => {
  let calls = 0;
  // Every coarse cell may hold a crossing, no pixel does: the worst case the cap bounds.
  const bounds: Bounds = (_x, _y, level) => (calls++, level ? [0, 1] : [1, 0]);
  const hit = walk(
    { x: 0.5, y: 0.5 },
    { x: 4000, y: 3000 },
    0.9,
    0.1,
    { x: 4096, y: 4096 },
    12,
    bounds,
  );
  assert.equal(hit, null);
  assert.equal(calls, REFLECTION_TRACE_STEPS);
});
