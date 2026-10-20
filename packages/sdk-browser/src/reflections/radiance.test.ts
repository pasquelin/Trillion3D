// The radiance pyramid's shipped kernels (`RADIANCE_SHADER`) run as JavaScript: the first makes
// levels 1 and 2 of the drawn image — its level 0 is the lit image itself — as the second makes
// every further two — the separable tent [1, 3, 3, 1] / 8, read as four bilinear taps, which keeps
// the image's energy.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  fakePyramid,
  image,
  radianceKernels,
  recordedBuild,
  type Image,
} from './radianceKernels.fixture.ts'

/** The workgroups the shipped build dispatches for the first two levels of an image of `size`: the
 *  dispatch of `encodeRadiancePyramid` over a pyramid of three levels, recorded. */
function firstDispatch(size: [number, number]) {
  return recordedBuild(fakePyramid(3, size[0], size[1]))(size).dispatches[0]
}

const sum = (img: Image) => img.texels.reduce((s, t) => s.map((v, c) => v + t[c]), [0, 0, 0, 0])
const close = (a: number[], b: number[], tolerance: number) =>
  a.every((v, c) => Math.abs(v - b[c]) <= tolerance * Math.max(1, Math.abs(b[c])))

test('the first kernel makes levels 1 and 2 of the drawn image as every further two are', () => {
  const whole = image(40, 36, (x, y) => [x * 0.1, y * 0.05, (x * y) % 7, x < 30 ? 1 : 0.5])
  const k = radianceKernels([40, 36, 0, 0])
  const made = k.first(whole)
  const again = k.down(whole)
  for (const level of ['coarser', 'coarsest'] as const)
    for (let i = 0; i < made[level].texels.length; i++)
      assert.ok(close(made[level].texels[i], again[level].texels[i], 1e-12), `${level} ${i}`)
})

test('a level keeps the energy of the one before it, through a separable symmetric tent', () => {
  const k = radianceKernels([64, 64, 0, 0])
  // Light away from the border, so that no weight falls outside.
  const source = image(64, 64, (x, y) =>
    x > 4 && x < 58 && y > 4 && y < 58 ? [Math.sin(x) + 1.5, (x + y) % 5, 1, 1] : [0, 0, 0, 0],
  )
  const { coarser, coarsest } = k.down(source)
  assert.ok(
    close(
      sum(coarser).map((v) => 4 * v),
      sum(source),
      1e-12,
    ),
  )
  assert.ok(
    close(
      sum(coarsest).map((v) => 4 * v),
      sum(coarser),
      1e-12,
    ),
  )
  // One point: the outer product of [3, 1] / 8 and its mirror, the same on both axes.
  const point = image(16, 16, (x, y) => (x === 8 && y === 8 ? [64, 0, 0, 0] : [0, 0, 0, 0]))
  const blob = k.down(point).coarser
  const at = (x: number, y: number) => blob.texels[y * 8 + x][0]
  assert.equal(at(4, 4), 9)
  assert.equal(at(3, 4), 3)
  assert.equal(at(4, 3), 3)
  assert.equal(at(3, 3), 1)
  assert.equal(sum(blob)[0], 16)
})

test('the dispatch makes every texel of levels 1 and 2 of an image of any width', () => {
  // The widths either side of a multiple of 4 and of 32, where a level cut down by a floor leaves
  // the last pixel or the last texel unmade.
  for (const width of [1025, 1026, 1027, 33, 34, 35]) {
    const height = 41
    const source = image(width, height, (x, y) => [x * 0.01, y * 0.01, 1, 1])
    const groups = firstDispatch([width, height])
    const k = radianceKernels([width, height, 0, 0])
    const { coarser, coarsest } = k.first(source, groups)
    for (const [level, img] of [coarser, coarsest].entries()) {
      const missing = img.texels.findIndex((texel) => !(texel[3] > 0))
      assert.equal(missing, -1, `width ${width}, level ${level + 1}: texel ${missing} unmade`)
    }
  }
})
