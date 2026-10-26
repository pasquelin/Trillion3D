// The temporal passes' colour: what the translucency makes of it, the packed formats it is stored
// in and the dither it is rounded with, run in JavaScript from the shipped text.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { TRANSLUCENCY_WGSL } from './translucencyWgsl.ts'
import { DITHER_WGSL, sceneColorWgsl } from './colorSpaceWgsl.ts'
import { close, type Vec } from './taaBuiltins.fixture.ts'

test('the temporal passes read how much of the colour the translucency makes, from the composed colour and the layers', () => {
  const texel = { value: [0, 0, 0, 1] }
  const { translucencyRatio, beforeLayers } = shaderRun<{
    translucencyRatio: (composed: Vec, layers: Vec) => number
    beforeLayers: (composed: Vec, layers: Vec) => Vec
  }>(wgslProgram('', [TRANSLUCENCY_WGSL]), ['translucencyRatio', 'beforeLayers'], {
    translucency: texel,
    textureLoad: () => texel.value,
    textureDimensions: () => [1, 1],
  })
  // The perceptual luma: the root of the mean of the squared `x / (x + 0.17)`.
  const luma = (rgb: Vec) => Math.sqrt(rgb.reduce((sum, x) => sum + (x / (x + 0.17)) ** 2, 0) / 3)
  const scene = [0.5, 0.4, 0.3],
    light = [0.1, 0.2, 0.05],
    through = 0.25
  const composed = scene.map((x, i) => x * through + light[i])
  const layers = [...light, through]
  // The colour before the layers: the scene, from the composed colour and the layers.
  close(beforeLayers(composed, layers), scene)
  assert.deepEqual(
    beforeLayers(composed, [0, 0, 0, 0]),
    [0, 0, 0],
    'none where nothing is let through',
  )
  // `light / (light + scene · transmittance + 0.0005)`, in the perceptual luma.
  const expected = luma(light) / (luma(light) + luma(scene) * through + 0.0005)
  assert.ok(Math.abs(translucencyRatio(composed, layers) - expected) < 1e-5)
  // A texel no layer covers makes none of its colour; one the layers hide wholly, all of it.
  assert.equal(translucencyRatio(scene, [0, 0, 0, 1]), 0)
  assert.ok(translucencyRatio(light, [...light, 0]) > 0.99)
})

// The scene colour the shading rejection hands the history update is a storage buffer standing in
// for a texture of the history's colour format (`sceneColorWgsl`): each channel must round as the
// format does — toward zero, the rounding the stochastic rounding before it is made for — and read
// back the format's exact value. The formats' definitions: a float of five exponent bits (bias 15)
// and `m` mantissa bits, no sign for the 11- and 10-bit ones, denormals at exponent 0, the largest
// finite where exponent 31 would start.
test('the scene colour packs each channel as its format rounds toward zero, and reads back its exact value', () => {
  const run = shaderRun<{
    packSmallFloatDown: (f: number, mantissa: number) => number
    unpackSmallFloat: (code: number, mantissa: number) => number
    packHalf: (f: number) => number
    packSceneColor: (c: Vec) => number[]
    unpackSceneColor: (w: number[]) => Vec
  }>(
    wgslProgram('', [sceneColorWgsl('rg11b10ufloat')]),
    ['packSmallFloatDown', 'unpackSmallFloat', 'packHalf', 'packSceneColor', 'unpackSceneColor'],
    {},
  )
  /** The value of code `code` of a float of five exponent bits and `m` mantissa bits. */
  const decode = (code: number, m: number) => {
    const e = code >> m,
      fraction = code & ((1 << m) - 1)
    return e === 0 ? (fraction / 2 ** m) * 2 ** -14 : (1 + fraction / 2 ** m) * 2 ** (e - 15)
  }
  /** The format's code of `f` rounded toward zero: the largest finite code whose value is no more. */
  const truncated = (f: number, m: number) => {
    if (!(f > 0)) return 0
    // The codes' values grow with the codes: a bisection finds the last one at or below `f`.
    let low = 0,
      high = (30 << m) | ((1 << m) - 1)
    while (low < high) {
      const middle = (low + high + 1) >> 1
      if (decode(middle, m) <= f) low = middle
      else high = middle - 1
    }
    return low
  }
  for (const m of [6, 5, 10]) {
    const last = (30 << m) | ((1 << m) - 1)
    const values: number[] = [0, -1, NaN, 1e9, Infinity, 2 ** -30]
    for (let code = 0; code <= last; code += m === 10 ? 7 : 1) {
      const value = decode(code, m)
      values.push(value, Math.fround(value * (1 + 2 ** -20)), Math.fround(value * (1 - 2 ** -20)))
      if (code < last) values.push(Math.fround((value + decode(code + 1, m)) / 2))
    }
    for (const f of values.map(Math.fround)) {
      assert.equal(run.packSmallFloatDown(f, m), truncated(f, m), `${f} in ${m} mantissa bits`)
      if (m === 10 && f >= 0) assert.equal(run.packHalf(f), truncated(f, 10), `half ${f}`)
    }
    for (let code = 0; code <= last; code++)
      assert.equal(run.unpackSmallFloat(code, m), decode(code, m), `code ${code} of ${m} bits`)
  }
  assert.equal(run.packHalf(-2.5), 0x8000 | truncated(2.5, 10), 'a half keeps its sign')
  // Red in the low eleven bits, green in the next eleven, blue in the high ten, as the format lays them.
  const colour = [Math.fround(0.3), Math.fround(17.25), Math.fround(60000)]
  const [word] = run.packSceneColor([...colour, 1])
  assert.equal(
    word >>> 0,
    (truncated(colour[0], 6) |
      (truncated(colour[1], 6) << 11) |
      (truncated(colour[2], 5) << 22)) >>>
      0,
  )
  assert.deepEqual(run.unpackSceneColor([word]), [
    decode(truncated(colour[0], 6), 6),
    decode(truncated(colour[1], 6), 6),
    decode(truncated(colour[2], 5), 5),
    1,
  ])
})

// A float target rounds toward zero: the dither adds a draw of its step, so the rounding averages to
// the value. The draws here are the 1024 equal shares of [0, 1), the target's rounding is made in
// the test, and the mean of the rounded values must be the value to one share of a step.
test('the dither of a float target makes its rounding toward zero average to the value, at any exponent', () => {
  const { ditherFloat } = shaderRun<{
    ditherFloat: (colour: Vec, draw: number, errors: Vec) => Vec
  }>(wgslProgram('', [DITHER_WGSL]), ['ditherFloat'], {})
  // The mantissa bits of an 11-11-10 float, red and green six, blue five: `2^-bits` each.
  const bits = [6, 6, 5]
  const errors = bits.map((b) => 2 ** -b)
  /** `value` rounded toward zero to a float of `m` mantissa bits. */
  const truncated = (value: number, m: number) => {
    const step = 2 ** (Math.floor(Math.log2(value)) - m)
    return Math.floor(value / step) * step
  }
  const draws = 1024
  for (const colour of [
    [0.3, 17.25, 3],
    [0.001, 100.7, 0.51],
    [5000.3, 0.07, 12345],
  ]) {
    const means = [0, 0, 0]
    for (let i = 0; i < draws; i++)
      ditherFloat(colour, (i + 0.5) / draws, errors).forEach((value, c) => {
        means[c] += truncated(value, bits[c]) / draws
      })
    colour.forEach((value, c) => {
      const step = 2 ** (Math.floor(Math.log2(value)) - bits[c])
      assert.ok(
        Math.abs(means[c] - value) <= (step / draws) * 1.001,
        `channel ${c} of ${colour}: ${means[c]} against ${value}`,
      )
    })
  }
})
