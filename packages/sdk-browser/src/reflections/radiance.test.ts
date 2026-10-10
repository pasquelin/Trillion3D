// The radiance pyramid's shipped kernels (`RADIANCE_SHADER`) run as JavaScript: the first copies
// the drawn image into level 0 and makes levels 1 and 2 as the second makes every further two — the
// separable tent [1, 3, 3, 1] / 8, read as four bilinear taps, which keeps the image's energy.
import test from 'node:test'
import assert from 'node:assert/strict'
import { image, radianceKernels, type Image } from './radianceKernels.fixture.ts'
import { encodeRadiancePyramid, type RadianceInputs } from './radiance.ts'

/** The workgroups the shipped build dispatches for the first two levels of an image of `size`: the
 *  dispatch of `encodeRadiancePyramid` over a pyramid of three levels, recorded. */
function firstDispatch(size: [number, number]) {
  const dispatched: number[][] = []
  const pass = {
    setPipeline() {},
    setBindGroup() {},
    dispatchWorkgroups: (...groups: number[]) => dispatched.push(groups),
  }
  const inputs = { hdr: {}, view: {}, hash: {} } as unknown as RadianceInputs
  const pipelines = {} as Parameters<typeof encodeRadiancePyramid>[3]
  const pyramid = {
    levels: 3,
    texture: { width: size[0], height: size[1] },
    held: { valid: false, viewProjection: new Float64Array(16), size: [0, 0], still: false },
    // The groups the build keeps while its inputs stay (`buildGroups`): the roll's and the first's.
    build: { key: [inputs.hdr, inputs.view, inputs.hash, pipelines], groups: [{}], roll: {} },
  } as unknown as Parameters<typeof encodeRadiancePyramid>[2]
  encodeRadiancePyramid(
    pass as unknown as GPUComputePassEncoder,
    {} as GPUDevice,
    pyramid,
    pipelines,
    inputs,
    size,
    new Float64Array(16),
  )
  // The roll is one workgroup; the first dispatch follows it.
  return dispatched[1]
}

const sum = (img: Image) => img.texels.reduce((s, t) => s.map((v, c) => v + t[c]), [0, 0, 0, 0])
const close = (a: number[], b: number[], tolerance: number) =>
  a.every((v, c) => Math.abs(v - b[c]) <= tolerance * Math.max(1, Math.abs(b[c])))

test('the first kernel copies the drawn image, and makes two levels as every further two are', () => {
  // An image larger than its drawn part, its coverage past 1 where a blend over-covers.
  const source = image(40, 36, (x, y) => [x * 0.1, y * 0.05, (x * y) % 7, x < 30 ? 1.5 : 0.5])
  const { copy } = radianceKernels([34, 30, 0, 0]).first(source)
  for (let y = 0; y < 36; y++)
    for (let x = 0; x < 40; x++) {
      const inside = x < 34 && y < 30
      const expected = inside
        ? [...source.texels[y * 40 + x].slice(0, 3), Math.min(source.texels[y * 40 + x][3], 1)]
        : [0, 0, 0, 0]
      assert.deepEqual(copy.texels[y * 40 + x], expected, `${x},${y}`)
    }
  // Drawn whole, its coverage within one: levels 1 and 2 from the image are those of its copy.
  const whole = image(40, 36, (x, y) => [x * 0.1, y * 0.05, (x * y) % 7, x < 30 ? 1 : 0.5])
  const k = radianceKernels([40, 36, 0, 0])
  const made = k.first(whole)
  const again = k.down(made.copy)
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

test('the dispatch makes every texel of levels 0 to 2 of an image of any width, odd or not', () => {
  // The widths either side of a multiple of 4 and of 32, where a level cut down by a floor leaves
  // the last pixel or the last texel unmade.
  for (const width of [1025, 1026, 1027, 33, 34, 35]) {
    const height = 41
    const source = image(width, height, (x, y) => [x * 0.01, y * 0.01, 1, 1])
    const { copy, coarser, coarsest } = radianceKernels([width, height, 0, 0]).first(
      source,
      firstDispatch([width, height]),
    )
    for (const [level, img] of [copy, coarser, coarsest].entries()) {
      const missing = img.texels.findIndex((texel) => !(texel[3] > 0))
      assert.equal(missing, -1, `width ${width}, level ${level}: texel ${missing} unmade`)
    }
  }
})

test('the image hash changes with any texel, and with where it lies, and no order of the threads changes it', () => {
  const source = (x0: number, y0: number, v: number) =>
    image(40, 36, (x, y) => (x === x0 && y === y0 ? [v, 0, 0, 1] : [0.25, 0.5, 0.75, 1]))
  const k = radianceKernels([40, 36, 0, 0])
  const base = k.first(source(3, 4, 1)).hash
  assert.deepEqual(k.first(source(3, 4, 1)).hash, base, 'the same image, the same hash')
  assert.notDeepEqual(k.first(source(3, 4, 1.0000001)).hash, base, 'a texel')
  assert.notDeepEqual(k.first(source(4, 3, 1)).hash, base, 'where it lies')
  // Another workgroup order (two rows of groups, taken in turn) sums to the same two words.
  assert.deepEqual(radianceKernels([40, 36, 0, 0]).first(source(3, 4, 1), [2, 2]).hash, base)
})
