// A source drawn below the display is brought to its size in the composition, by the shipped text run
// in JavaScript.
import test from 'node:test'
import assert from 'node:assert/strict'
import { CONTRACT_COMPOSITIONS } from './shaders.ts'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'

test('a source drawn below the display is upscaled by the Catmull-Rom cubic, held to the colours a pixel can show', () => {
  const [W, H] = [8, 7]
  const at = (x: number, y: number) => [
    Math.min(Math.max(x, 0), W - 1),
    Math.min(Math.max(y, 0), H - 1),
  ]
  const texel = (x: number, y: number) => {
    const [cx, cy] = at(x, y)
    return [
      Math.sin(cx * 1.3 + cy * 0.7) + 1,
      Math.cos(cx * 0.4 - cy * 0.9) + 1,
      (cx * 3 + cy * 5) % 7,
      0.5,
    ]
  }
  // The bilinear read of the source, as the composition's own function gives it, on this field.
  const bilinear = (p: number[]) => {
    const [tx, ty] = [p[0] - 0.5, p[1] - 0.5]
    const [ix, iy, fx, fy] = [
      Math.floor(tx),
      Math.floor(ty),
      tx - Math.floor(tx),
      ty - Math.floor(ty),
    ]
    return texel(0, 0).map(
      (_, k) =>
        (1 - fy) * ((1 - fx) * texel(ix, iy)[k] + fx * texel(ix + 1, iy)[k]) +
        fy * ((1 - fx) * texel(ix, iy + 1)[k] + fx * texel(ix + 1, iy + 1)[k]),
    )
  }
  const { sourceBicubic } = shaderRun<{ sourceBicubic: (p: number[]) => number[] }>(
    CONTRACT_COMPOSITIONS.plain.flagless,
    ['sourceBicubic'],
    { sourceBilinear: bilinear },
  )
  const catmull = (t: number) => {
    const a = Math.abs(t)
    return a < 1
      ? 1.5 * a ** 3 - 2.5 * a * a + 1
      : a < 2
        ? -0.5 * a ** 3 + 2.5 * a * a - 4 * a + 2
        : 0
  }
  let [centre, cubic] = [0, 0]
  for (let n = 0; n < 300; n++) {
    const [x, y] = [2.5 + Math.random() * (W - 5), 2.5 + Math.random() * (H - 5)]
    const exact = [0, 0, 0, 0]
    for (let i = Math.floor(x - 0.5) - 1; i <= Math.floor(x - 0.5) + 2; i++)
      for (let j = Math.floor(y - 0.5) - 1; j <= Math.floor(y - 0.5) + 2; j++)
        texel(i, j).forEach((v, k) => (exact[k] += catmull(x - 0.5 - i) * catmull(y - 0.5 - j) * v))
    const got = sourceBicubic([x, y])
    cubic = Math.max(cubic, ...got.map((v, k) => Math.abs(v - Math.max(exact[k], 0))))
    if (n < W * H) {
      const [i, j] = [1 + (n % (W - 2)), 1 + (Math.floor(n / (W - 2)) % (H - 2))]
      centre = Math.max(
        centre,
        ...sourceBicubic([i + 0.5, j + 0.5]).map((v, k) => Math.abs(v - texel(i, j)[k])),
      )
    }
  }
  // A pixel's centre is the pixel; elsewhere the five reads are within a percent of the cubic's sixteen.
  assert.ok(centre < 1e-12, `at a centre: ${centre}`)
  assert.ok(cubic < 0.06, `against the sixteen-tap cubic: ${cubic}`)
  // The cubic's negative lobes never leave a colour below black nor a coverage past one.
  const edge = (p: number[]) => [p[0] > 4 ? 8 : 0, 0, 0, p[0] > 4 ? 1 : 0]
  const step = shaderRun<{ sourceBicubic: (p: number[]) => number[] }>(
    CONTRACT_COMPOSITIONS.plain.flagless,
    ['sourceBicubic'],
    { sourceBilinear: edge },
  )
  for (let x = 3; x < 6; x += 0.125)
    assert.ok(
      step.sourceBicubic([x, 3.5]).every((v, k) => v >= 0 && (k < 3 || v <= 1)),
      `${x}`,
    )
})
