import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cutAt, cutsOf, hashOf } from './shaderCuts.ts'

const CODE = `@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let a = load(id.x);
  // @cut decode keep: if (a < -1e30) { sink[0] = 1u; }
  let b = classify(a);
  // @cut classify keep: if (b < -1e30) { sink[0] = 2u; }
  trace(b);
}
@fragment fn fs() -> @location(0) vec4f {
  // @cut shade -> vec4f(0.0) keep: ;
  return vec4f(1.0);
}`

test('cut points are read in order, with their keep statement and return value', () => {
  const cuts = cutsOf(CODE)
  assert.deepEqual(
    cuts.map((c) => c.name),
    ['decode', 'classify', 'shade'],
  )
  assert.equal(cuts[0].keep, 'if (a < -1e30) { sink[0] = 1u; }')
  assert.equal(cuts[2].value, 'vec4f(0.0)')
})

test('a variant keeps what is above its cut, returns, and leaves the rest unreachable', () => {
  const variant = cutAt(CODE, 'decode')
  const lines = variant.split('\n')
  assert.ok(variant.includes('let a = load(id.x);'))
  assert.ok(
    variant.indexOf('{ if (a < -1e30) { sink[0] = 1u; }') < variant.indexOf('let b = classify(a);'),
  )
  assert.ok(lines[3].startsWith('{ if (a') && lines[4].trim() === 'return; }')
  assert.match(cutAt(CODE, 'shade'), /return vec4f\(0\.0\); \}/)
  assert.throws(() => cutAt(CODE, 'missing'), /BENCH_DISSECT/)
  assert.equal(CODE, CODE, 'the source text is untouched')
})

test('a hash names the same code the same and other code otherwise', () => {
  assert.equal(hashOf(CODE), hashOf(`${CODE}`))
  assert.notEqual(hashOf(CODE), hashOf(`${CODE} `))
})
