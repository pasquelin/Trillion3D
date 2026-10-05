import test from 'node:test';
import assert from 'node:assert/strict';
import { shaderRun } from './shaderRun.fixture.ts';

test('a component is assigned in place, a value held by two names is two values', () => {
  const { f } = shaderRun<{ f: (s: Record<string, number>) => unknown }>(
    `fn f(s:S)->vec4f{
 var p:vec2i=vec2i(1,2);var origin:vec2i=p;p.x+=3;p.y=7;
 var c:vec4f=vec4f(0.0);c.a=1.0;c.g++;
 var rows:array<vec2f,2>;rows[0]=vec2f(1.0);var copy=rows;copy[0].x=5.0;
 s.x=9.0;var t=s;t.x=4.0;
 return vec4f(f32(origin.x+p.x),f32(p.y),c.a+c.g,rows[0].x+copy[0].x+s.x);
}`,
    ['f'],
    {},
  );
  const s = { x: 0 };
  // origin keeps 1 while p becomes 4; a structure's member `x` is its key, not a component, and a
  // copy of the structure is written apart.
  assert.deepEqual(f(s), [5, 7, 2, 15]);
  assert.deepEqual(s, { x: 9 });
});
