// The nodes of the material graph beyond the four rules: the functions of one number and of two,
// the colour nodes, the camera's vector and the vertex colour, and the noise.
import test from 'node:test'
import assert from 'node:assert/strict'
import { material } from '../../../../sdk-core/src/world/material/index.ts'
import type { Pin } from '../../../../sdk-core/src/world/material/graph/graph.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { COLOR_SAMPLE_WGSL } from '../virtual/wgsl.ts'
import { Mat } from '../texture/shaderRunMatrix.fixture.ts'
import { compileGraph } from './compile.ts'
import { VIEW_FORWARD_WGSL } from './program.ts'
import { shaderRun } from '../texture/shaderRun.fixture.ts'
import { body, constant, type Graph } from './graphBody.fixture.ts'

test('the functions of one number fold their constants as the preshader holds them, and write their calls otherwise', () => {
  const folds = (build: (g: Graph) => Pin) => constant(body(build))[0]
  assert.equal(
    folds((g) => g.sqrt(g.constant(4))),
    2,
  )
  assert.equal(
    folds((g) => g.exp(g.constant(0))),
    1,
  )
  assert.equal(
    folds((g) => g.exp2(g.constant(3))),
    8,
  )
  assert.equal(
    folds((g) => g.log(g.constant(1))),
    0,
  )
  assert.equal(
    folds((g) => g.log2(g.constant(8))),
    3,
  )
  assert.ok(Math.abs(folds((g) => g.log10(g.constant(1000))) - 3) < 1e-6)
  assert.deepEqual(
    [-2, 0, 7].map((x) => folds((g) => g.sign(g.constant(x)))),
    [-1, 0, 1],
  )
  // The rounding of a shared value goes up at a half: -2.5 is -2, 2.5 is 3.
  assert.deepEqual(
    [-2.5, 2.5, 0.4].map((x) => folds((g) => g.round(g.constant(x)))),
    [-2, 3, 0],
  )
  // A constant with no finite result is refused: no shader literal holds it.
  assert.throws(() => body((g) => g.sqrt(g.constant(-1))), /sqrt of -1 has no finite value/)
  assert.throws(() => body((g) => g.log(g.constant(0))), /log of 0 has no finite value/)
  const at = (g: Graph) => g.componentMask(g.worldPosition(), 'r')
  assert.match(
    body((g) => g.sqrt(at(g))),
    /sqrt\(v0\)/,
  )
  assert.match(
    body((g) => g.log2(at(g))),
    /log2\(v0\)/,
  )
  assert.match(
    body((g) => g.log10(at(g))),
    /\(log2\(v0\)\*0\.301030010\)/,
  )
  assert.match(
    body((g) => g.round(at(g))),
    /round\(v0\)/,
    'a varying value goes to the even whole',
  )
  assert.match(
    body((g) => g.round(g.scalarParameter('p'))),
    /floor\(g\.v\[0\]\.x\+0\.5\)/,
  )
  // A tangent turns by its period as the sine does.
  assert.match(
    body((g) => g.tangent(at(g))),
    /tan\(\(v0 \* 6\.28318548\)\)|tan\(v1\)/,
  )
  assert.match(
    body((g) => g.tangent(at(g), 0)),
    /tan\(v0\)/,
  )
})

test('an arctangent of two takes the angle of the point; a remainder keeps the sign of its dividend and floors the divisor it shares', () => {
  const folds = (build: (g: Graph) => Pin) => constant(body(build))[0]
  assert.equal(
    folds((g) => g.arctangent2(g.constant(1), g.constant(1))),
    Math.fround(Math.PI / 4),
  )
  assert.equal(
    folds((g) => g.arctangent2(g.constant(0), g.constant(-1))),
    Math.fround(Math.PI),
  )
  assert.equal(
    folds((g) => g.fmod(g.constant(-5.5), g.constant(2))),
    -1.5,
  )
  assert.equal(
    folds((g) => g.fmod(g.constant(5.5), g.constant(2))),
    1.5,
  )
  assert.match(
    body((g) => g.fmod(g.constant(5), g.constant(0))),
    /let v0:f32=0\.00000000;\n let v1:f32=\(5\.00000000 % v0\);/,
    'a constant zero is not floored: the shader’s, its divisor held in a local',
  )
  const at = (g: Graph) => g.componentMask(g.worldPosition(), 'r')
  assert.match(
    body((g) => g.arctangent2(at(g), g.componentMask(g.worldPosition(), 'g'))),
    /atan2\(v0,v1\)/,
  )
  assert.match(
    body((g) => g.fmod(at(g), g.constant(0))),
    /\(v0 % 0\.00000000\)/,
    'a varying dividend over zero is the shader’s',
  )
  assert.match(
    body((g) => g.fmod(g.scalarParameter('p'), g.constant(0))),
    /\(g\.v\[0\]\.x % 0\.00000000\)/,
  )
  assert.throws(
    () => body((g) => g.fmod(g.constant(1, 2), g.constant(1, 2, 3))),
    /arithmetic between float2 and float3 is undefined/,
  )
})

test('a contrast spreads from its pivot, a desaturation goes to the luminance, a fresnel is the grazing power of the normal against the camera', () => {
  const rgb = (build: (g: Graph) => Pin) => constant(body(build))
  assert.equal(rgb((g) => g.contrast(g.constant(0.75), 2))[0], 1, 'about the pivot 0.5')
  assert.equal(rgb((g) => g.contrast(g.constant(0.75), 2, 0.25))[0], 1.25)
  assert.equal(rgb((g) => g.contrast(g.constant(0.3)))[0], Math.fround(0.3 - 0.5 + 0.5))
  const grey = Math.fround(0.212639005)
  assert.ok(Math.abs(rgb((g) => g.desaturation(g.constant(1, 0, 0)))[0] - grey) < 1e-6)
  assert.ok(
    Math.abs(rgb((g) => g.desaturation(g.constant(1, 0, 0), 0))[0] - 1) < 1e-6,
    'fraction 0',
  )
  assert.ok(Math.abs(rgb((g) => g.desaturation(g.constant(1, 0, 0), 1))[2] - grey) < 1e-6)
  assert.ok(Math.abs(rgb((g) => g.desaturation(g.constant(1, 0, 0), 1, [1, 0, 0]))[1] - 1) < 1e-6)
  assert.throws(
    () => body((g) => g.desaturation(g.constant(1, 0, 0, 1))),
    /cannot cast from larger type float4 to smaller float3/,
  )
  assert.throws(
    () =>
      body((g) => g.addNode('desaturation', { luminance: [1, 2] }, { input: g.constant(1, 1, 1) })),
    /desaturation weighs three channels/,
  )
  const text = body((g) => g.fresnel())
  assert.match(
    text,
    /let v0:vec3f=select\(normalize\(ctx\.eye-ctx\.world\),-ctx\.viewForward,any\(ctx\.viewForward!=vec3f\(0\.0\)\)\);\n let v1:f32=dot\(ctx\.pixelNormal,v0\);/,
  )
  assert.match(text, /max\(v4,0\.0000999999975\)/, 'the base of the power is held above 0.0001')
  assert.match(text, /pow\(v5,5\.00000000\)/)
  assert.match(text, /\(v6 \* 0\.959999979\)/)
  assert.match(text, /\(v7 \+ 0\.0399999991\)/)
  assert.match(
    body((g) => g.fresnel({ normal: g.vertexNormal(), exponent: 2, baseReflectFraction: 0 })),
    /dot\(ctx\.vertexNormal,v0\)[^]*pow\(v5,2\.00000000\)/,
  )
  const light = material.graph('lightFunction')
  light.output('emissive', light.fresnel())
  assert.throws(
    () => compileGraph(light, { sample: COLOR_SAMPLE_WGSL, derivatives: 'neighbours' }),
    /pixelNormal has no value in the lightFunction domain/,
  )
})

test('a camera vector is the unit vector to the camera where the domain has a position; a vertex colour is refused until a pass carries it', () => {
  assert.match(
    body((g) => g.cameraVector()),
    /let v0:vec3f=select\(normalize\(ctx\.eye-ctx\.world\),-ctx\.viewForward,any\(ctx\.viewForward!=vec3f\(0\.0\)\)\);/,
  )
  const light = material.graph('lightFunction')
  light.output('emissive', light.cameraVector())
  assert.throws(
    () => compileGraph(light, { sample: COLOR_SAMPLE_WGSL, derivatives: 'neighbours' }),
    /cameraVector has no value in the lightFunction domain/,
  )
  assert.throws(() => body((g) => g.vertexColor()), /vertexColor is not carried by this pass/)
  const carried = body((g) => g.channel(g.vertexColor(), 'rgb'), { vertexColor: true })
  assert.match(carried, /ctx\.vertexColor\.xyz/)
  const g = material.graph('surface')
  g.output('emissive', g.channel(g.vertexColor(), 'a'))
  const compiled = compileGraph(g, {
    sample: COLOR_SAMPLE_WGSL,
    derivatives: 'neighbours',
    vertexColor: true,
  })
  assert.ok(compiled.uses.colour && !compiled.uses.position)
  assert.match(wgslModule(compiled.wgsl), /vertexColor:vec4f/)
})

test('an orthographic view looks along the axis its x and y rows leave still, a perspective view along none', () => {
  const run = shaderRun<{ mgViewForward(m: Mat, eye: number[], world: number[]): number[] }>(
    wgslModule(VIEW_FORWARD_WGSL),
    ['mgViewForward'],
    {},
  )
  const forward = (view: Mat, eye: number[]) =>
    run.mgViewForward(view, eye, [1, 2, 0]).map((x) => x + 0)
  // Column-major, as WGSL lays a matrix: x and y rows that read x and y; the side the axis is turned
  // to is the one the point lies on, seen from the eye.
  const orthographic = new Mat([0.5, 0, 0, 0, 0, 0.25, 0, 0, 0, 0, -0.1, 0, 0, 0, 0.3, 1])
  assert.deepEqual(forward(orthographic, [0, 0, 5]), [0, 0, -1])
  assert.deepEqual(forward(orthographic, [0, 0, -5]), [0, 0, 1])
  // A perspective matrix has the depth in its last row: no direction, the vector to the eye is used.
  const perspective = new Mat([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, -1, 0, 0, -0.2, 0])
  assert.deepEqual(forward(perspective, [0, 0, 5]), [0, 0, 0])
})

test('a normalisation is plain on every path, and a constant that overflows is left to the shader', () => {
  assert.deepEqual(
    constant(body((g) => g.normalize(g.constant(3, 0, 4)))),
    [0.6, 0, 0.8].map(Math.fround),
  )
  const zero = body((g) => g.normalize(g.constant(0, 0, 0)))
  assert.match(zero, /normalize\(/)
  assert.doesNotMatch(zero, /inverseSqrt|max\(/)
  const big = body((g) => g.multiply(g.constant(3e38), g.constant(3e38)))
  assert.doesNotMatch(big, /return vec3f\(inf|return vec3f\(Infinity/)
  assert.match(big, /\*/)
})
