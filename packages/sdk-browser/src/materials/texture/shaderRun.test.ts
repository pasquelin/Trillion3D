import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from './shaderRun.fixture.ts'
import { Mat } from './shaderRunMatrix.fixture.ts'

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
  )
  const s = { x: 0 }
  // origin keeps 1 while p becomes 4; a structure's member `x` is its key, not a component, and a
  // copy of the structure is written apart.
  assert.deepEqual(f(s), [5, 7, 2, 15])
  assert.deepEqual(s, { x: 9 })
})

test('a program run again is compiled once, called with its new scope', () => {
  const text = 'fn scaled(x:f32)->f32{return x*k;}'
  let made = 0
  const original = globalThis.Function
  globalThis.Function = new Proxy(original, {
    construct: (target, args) => (made++, Reflect.construct(target, args)),
  })
  try {
    const one = shaderRun<{ scaled: (x: number) => number }>(text, ['scaled'], { k: 2 })
    const two = shaderRun<{ scaled: (x: number) => number }>(text, ['scaled'], { k: 3 })
    assert.deepEqual([one.scaled(2), two.scaled(2)], [4, 6])
    assert.equal(made, 1, 'one translation, one compilation')
  } finally {
    globalThis.Function = original
  }
})

test('a 4×4 matrix times a 4×4 matrix is their product, the right one applied first', () => {
  const { f } = shaderRun<{ f: (a: Mat, b: Mat, v: number[]) => number[] }>(
    'fn f(a:mat4x4f,b:mat4x4f,v:vec4f)->vec4f{let m=a*b;return m*v;}',
    ['f'],
    {},
  )
  // A scales by two, B translates by (1, 0, 0): A * B moves the point first, then scales it.
  const scale = new Mat([2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1])
  const move = new Mat([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 1])
  assert.deepEqual(f(scale, move, [1, 1, 1, 1]), [4, 2, 2, 1])
  assert.deepEqual(f(move, scale, [1, 1, 1, 1]), [3, 2, 2, 1])
})

test('a row vector times a 4×4 matrix is the vector against each column', () => {
  const { f } = shaderRun<{ f: (v: number[], m: Mat) => number[] }>(
    'fn f(v:vec4f,m:mat4x4f)->vec4f{return v*m;}',
    ['f'],
    {},
  )
  // The plane (0, 0, 1, 5) carried by a translation of 2 along z: its offset moves by the plane's normal.
  const move = new Mat([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 2, 1])
  assert.deepEqual(f([0, 0, 1, 5], move), [0, 0, 1, 7])
})
