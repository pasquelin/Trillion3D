// What the material graph's text holds of its arithmetic: the clock a `time` node reads — the world's,
// or the wall clock with `ignorePause` —, the exponent of a `power`, read as its base, the divisor the
// pixels share and the normalization of a zero vector.
import test from 'node:test'
import assert from 'node:assert/strict'
import { material } from '../../../../sdk-core/src/world/material/index.ts'
import { compileGraph } from '../../materials/graph/compile.ts'
import { power } from '../../materials/graph/arith.ts'
import { Emitter } from '../../materials/graph/emitter.ts'
import { constantOf, type Value } from '../../materials/graph/value.ts'
import { body, constant, uv, type Graph } from '../../materials/graph/graphBody.fixture.ts'
import { COLOR_SAMPLE_WGSL } from '../../materials/virtual/wgsl.ts'

const compileFor = (g: ReturnType<typeof material.graph>) =>
  compileGraph(g, { sample: COLOR_SAMPLE_WGSL, derivatives: 'neighbours' })

test('a time node reads the world’s clock, or with ignorePause the wall clock; the panner and the rotator read the world’s', () => {
  const reads = (build: (g: ReturnType<typeof material.graph>) => unknown) => {
    const g = material.graph('surface')
    g.output('emissive', g.sine(build(g) as never, 2))
    return compileFor(g).wgsl.text.match(/ctx\.(real)?[tT]ime/g)
  }
  assert.deepEqual(
    reads((g) => g.time()),
    ['ctx.time'],
    'the default: the world’s, a pause holds it',
  )
  assert.deepEqual(
    reads((g) => g.time(undefined, true)),
    ['ctx.realTime'],
    'ignorePause: the wall clock',
  )
  assert.deepEqual(
    reads((g) => g.time(4)),
    ['ctx.time'],
    'a period wraps the world’s',
  )
  const slid = material.graph('surface')
  slid.output('emissive', slid.componentMask(slid.panner({ speed: [1, 0.5] }), 'r'))
  const slides = compileFor(slid).wgsl.text.match(/ctx\.(real)?[tT]ime/g)
  assert.ok(slides?.length && slides.every((clock) => clock === 'ctx.time'), `${slides}`)
})

test('a power reads its exponent as its base: a scalar repeated, a vector of its width one component at a time, other widths refused', () => {
  const run = (base: Value, exponent: Value) => {
    const e = new Emitter()
    return { value: power(e, base, exponent), lines: e.lines }
  }
  const f3 = (code: string): Value => ({ type: 'f3', code })
  const f2 = (code: string): Value => ({ type: 'f2', code })
  const f1 = (code: string): Value => ({ type: 'f1', code })
  // A vector exponent works on each component of a vector base; the base's type is the result's.
  const vec = run(f3('b'), f3('x'))
  assert.equal(vec.value.type, 'f3')
  assert.deepEqual(vec.lines, [
    'let v0:vec3f=select(pow(b,x),vec3f(0.00000000,0.00000000,0.00000000),b<=vec3f(2.98023295e-8,2.98023295e-8,2.98023295e-8));',
  ])
  // A scalar exponent is repeated; over a scalar base, a vector exponent gives its first component.
  assert.match(run(f3('b'), f1('s')).lines[0], /select\(pow\(b,vec3f\(s\)\),/)
  const scalar = run(f1('b'), f3('x'))
  assert.equal(scalar.value.type, 'f1')
  assert.match(scalar.lines[0], /select\(pow\(b,x\.x\),0\.00000000,b<=2\.98023295e-8\)/)
  // Two vectors of other widths are refused, whatever the exponent: a constant or not.
  assert.throws(() => run(f3('b'), f2('x')), /arithmetic between float3 and float2 is undefined/)
  assert.throws(
    () => run(f3('b'), constantOf('f2', [2, 3])),
    /arithmetic between float3 and float2 is undefined/,
  )
  // An exponent of 1 or 0 and a base of 0 are written as no code; the others of a constant fold
  // one component at a time, a base at or below 2^-25 giving zero.
  assert.deepEqual(run(f3('b'), constantOf('flex', [1])).lines, [])
  assert.deepEqual(run(f3('b'), constantOf('f3', [0, 0, 0])).value.constant, [1, 1, 1])
  const zero = run(constantOf('f3', [0, 0, 0]), constantOf('flex', [2]))
  assert.deepEqual([zero.value.constant, zero.lines], [[0, 0, 0], []])
  const folded = run(constantOf('f3', [1e-9, 0.25, -1]), constantOf('f3', [3, 0.5, 2]))
  assert.deepEqual([folded.value.constant, folded.lines], [[0, 0.5, 0], []])
})

test('a division is a plain division, by zero included; a divisor the pixels share under a varying dividend is its reciprocal', () => {
  const p = (g: Graph) => g.scalarParameter('p', 2)
  // Constants quotient exactly; over a constant zero the divisor is held in a local, which WGSL
  // does not fold (a constant division by zero is a compile error there).
  assert.equal(constant(body((g) => g.divide(g.constant(1), 4)))[0], 0.25)
  assert.match(
    body((g) => g.divide(g.constant(2), 0)),
    /let v0:f32=0\.00000000;\n let v1:f32=\(2\.00000000 \/ v0\);/,
  )
  // A parameter over a constant, or a constant over a parameter, is the quotient itself.
  assert.match(
    body((g) => g.divide(p(g), 0)),
    /\(g\.v\[0\]\.x \/ 0\.00000000\)/,
  )
  assert.match(
    body((g) => g.divide(2, g.scalarParameter('q'))),
    /\(2\.00000000 \/ g\.v\[0\]\.x\)/,
  )
  // A varying dividend over a parameter: one reciprocal, the product.
  const varying = body((g) => g.divide(uv(g, 'r'), p(g)))
  assert.match(varying, /let v\d:f32=\(1\.0\/g\.v\[0\]\.x\);\n let v\d:f32=\(v\d \* v\d\);/)
  // A varying divisor, and the constant zero under a varying dividend, are the hardware's.
  assert.match(
    body((g) => g.divide(uv(g, 'r'), uv(g, 'g'))),
    /\(v0 \/ v1\)/,
  )
  assert.match(
    body((g) => g.divide(uv(g, 'r'), 0)),
    /\(v0 \/ 0\.00000000\)/,
  )
})

test('a normalize is the hardware one on every path: no floor, a zero vector left to the shader', () => {
  assert.match(
    body((g) => g.normalize(g.constant(0, 0, 0))),
    /normalize\(v\d\)/,
  )
  assert.deepEqual(
    constant(body((g) => g.normalize(g.constant(3, 0, 4)))),
    [0.6, 0, 0.8].map(Math.fround),
  )
  assert.equal(constant(body((g) => g.normalize(g.constant(-3))))[0], -1)
  assert.match(
    body((g) => g.normalize(g.vectorParameter('v', [0, 0, 0, 1]))),
    /normalize\(v0\)/,
  )
  assert.match(
    body((g) => g.normalize(g.appendVector(uv(g, 'r'), uv(g, 'g')))),
    /normalize\(v2\)/,
  )
  assert.match(
    body((g) => g.normalize(uv(g, 'r'))),
    /\(v0\/abs\(v0\)\)/,
  )
})
