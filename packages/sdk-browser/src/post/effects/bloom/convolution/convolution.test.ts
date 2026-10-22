// The convolution bloom: the sizes of its transform, what is read of its kernel, and the three
// passes of the transform — the shipped WGSL, run in JavaScript — against a direct convolution.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../../../materials/texture/shaderRun.fixture.ts'
import { KERNEL_WGSL } from './kernelWgsl.ts'
import { analyseKernel, applyConstants, NORMALISED_BY, SCALED_BY } from './kernelStats.ts'
import { defaultBloomKernel } from './defaultKernel.ts'
import { FFT_PARAMS, fftShader } from './fftWgsl.ts'
import { planConvolution, roundUpPowerOfTwo, type ConvolutionLimits } from './plan.ts'
import { longestLine } from './convolutionPrograms.ts'
import { channelScale, transformShape, writeTransformWords } from './transformShape.ts'
import { twiddleTable } from './twiddles.ts'

const FULL: ConvolutionLimits = { side: 16384, maxLine: 4096, bytes: 2 ** 31 }
const ask = (view: number[], percent = 100) => ({ view, percent, size: 1, bufferScale: 0.133 })

test('a 1080p image convolves at its own size in a 2048 square, the rows first', () => {
  const plan = planConvolution(ask([1920, 1080]), FULL)
  assert.deepEqual([plan.level, plan.image, plan.frequency], [-1, [1920, 1080], [2048, 2048]])
  assert.deepEqual([plan.horizontalFirst, plan.columns], [true, 1025])
  assert.deepEqual(
    [plan.bytes.image, plan.bytes.kernel],
    [4 * 1080 * 1025 * 8, 4 * 2048 * 1025 * 8],
  )
})

test('the fraction picks the coarsest level that holds it and brings it down by one read', () => {
  const at = (percent: number) => planConvolution(ask([1920, 1080], percent), FULL)
  assert.deepEqual([at(50).level, at(50).image], [0, [960, 540]])
  assert.deepEqual([at(35.355).level, at(35.355).image], [0, [679, 382]]) // the half image by 0.7071
  assert.deepEqual([at(25).level, at(25).image], [1, [480, 270]])
  assert.equal(at(12.5).level, 2)
  assert.equal(at(1).fraction, Math.fround(0.1), 'a tenth of the image at least')
})

test('the transform is kept within the longest line the device holds, the image lowered to fit', () => {
  for (const maxLine of [2048, 4096])
    for (const view of [
      [1920, 1080],
      [3840, 2160],
      [5120, 2880],
      [641, 480],
      [17, 9],
    ]) {
      const plan = planConvolution(ask(view), { ...FULL, maxLine })
      for (const side of plan.frequency)
        assert.ok(side === roundUpPowerOfTwo(side) && side <= maxLine, `${view} at ${maxLine}`)
    }
  assert.deepEqual([longestLine(16384), longestLine(32768)], [2048, 4096])
  const small = planConvolution(ask([3840, 2160]), { ...FULL, maxLine: 2048 })
  assert.ok(small.image[0] < 2048 && small.fraction < 0.54)
})

/** A kernel of one bright texel `peak` in a plateau of 1, 5 texels across, 0.5 on its rim. */
function plateau(side: number, peak: number) {
  const pixels = new Float32Array(4 * side * side)
  for (let y = -2; y <= 2; y++)
    for (let x = -2; x <= 2; x++) {
      const at = 4 * ((side / 2 + y) * side + side / 2 + x)
      pixels.fill(Math.max(Math.abs(x), Math.abs(y)) === 2 ? 0.5 : x || y ? 1 : peak, at, at + 4)
    }
  return { width: side, height: side, pixels }
}

test('the kernel is read at its centre: the peak stays, the plateau spreads, held to the haze beside the peak', () => {
  const stats = analyseKernel(plateau(32, 1000), 32, 1)
  assert.deepEqual(
    [stats.centre, [...stats.maxScatter]],
    [
      [16, 16],
      [0.5, 0.5, 0.5, 0.5],
    ],
  )
  assert.deepEqual([stats.centreEnergy[0], stats.scatterEnergy[0]], [999.5, 25 * 0.5])
  assert.equal(
    analyseKernel({ width: 4, height: 4, pixels: new Float32Array(64) }, 4, 1).lit,
    false,
  )
})

test('the default kernel is a star whose centre is its brightest texel and about an eighth of its light spreads', () => {
  const stats = analyseKernel(defaultBloomKernel(), 1920, 1)
  const share = stats.scatterEnergy[0] / (stats.centreEnergy[0] + stats.scatterEnergy[0])
  assert.deepEqual(stats.centre, [256, 256])
  assert.ok(share > 0.08 && share < 0.2, `spread share ${share}`)
  assert.deepEqual(
    [stats.centreEnergy[1], stats.centreEnergy[2]],
    [stats.centreEnergy[0], stats.centreEnergy[0]],
  )
})

test('the image keeps what the glow did not take; a neutral kernel tints every channel alike', () => {
  const stats = analyseKernel(defaultBloomKernel(), 1920, 1)
  const { sceneTint, multiply } = applyConstants(stats, 0.675)
  const spread = (stats.scatterEnergy[0] * 0.675) / (stats.centreEnergy[0] + stats.scatterEnergy[0])
  assert.ok(Math.abs(sceneTint[0] - (1 - spread)) < 1e-9 && Math.abs(multiply[0] - spread) < 1e-9)
  assert.deepEqual([sceneTint[1], sceneTint[2]], [sceneTint[0], sceneTint[0]])
  assert.equal(applyConstants(stats, 0).sceneTint[0], 1, 'a spread of 0 takes nothing')
  const dark = analyseKernel({ width: 2, height: 2, pixels: new Float32Array(16) }, 2, 1)
  assert.deepEqual(
    [...applyConstants(dark, 1).sceneTint],
    [0, 0, 0, 0],
    'no light: the shares are none, held to 0',
  )
  assert.deepEqual(
    [[...NORMALISED_BY], [...SCALED_BY]],
    [
      [0, 2, 1, 3],
      [0, 1, 0, 3],
    ],
  )
  assert.deepEqual([...channelScale([0.1, 0.2, 0.3, 0.4])], [0.1, 0.2, 0.1, 0.4])
})

const grid = (columns: number, rows: number, value: (x: number, y: number, c: number) => number) =>
  Array.from({ length: rows }, (_, y) =>
    Array.from({ length: columns }, (_, x) => [0, 1, 2, 3].map((c) => value(x, y, c))),
  )

const reverseBits = (x: number) => {
  let r = 0
  for (let b = 0; b < 32; b++) r |= ((x >>> b) & 1) << (31 - b)
  return r >>> 0
}

/** The shipped transform text, one thread standing for the workgroup (`LANES` 1, a barrier no
 *  pass), over `texels` read as the picture and `kernelPlanes` as the kernel's transform; the
 *  uniform is written from a plan's shape. */
function transformRun(texels: number[][][], kernelPlanes: number[][], planes: number[][]) {
  const table = twiddleTable(256)
  const written = new Map<string, number[]>()
  const fft = {
    size: [0, 0, 0, 0],
    rois: [0, 0, 0, 0],
    mode: [0, 0, 0, 0],
    normBy: [...NORMALISED_BY],
    scale: [1, 1, 1, 1],
  }
  const scope = {
    LANES: 1,
    reverseBits,
    workgroupBarrier: () => undefined,
    fft,
    source: 'source',
    planes,
    kernelPlanes,
    factors: Array.from({ length: 128 }, (_, k) => [table[2 * k], table[2 * k + 1]]),
    glowOut: 'out',
    waves: Array.from({ length: 256 }, () => [0, 0]),
    textureLoad: (_: string, p: number[]) => texels[p[1]][p[0]],
    textureStore: (_: string, p: number[], v: number[]) => void written.set(p.join(','), v),
  }
  const passes = shaderRun<
    Record<'forwardRows' | 'convolveColumns' | 'inverseRows', (at: number[], lane: number) => void>
  >(fftShader(256), ['forwardRows', 'convolveColumns', 'inverseRows'], scope)
  return {
    written,
    /** The passes over a shape: the rows, then the columns, then — for an image — the rows back. */
    run(shape: ReturnType<typeof transformShape>) {
      const words = new Float32Array(FFT_PARAMS.words)
      writeTransformWords(words, shape, [1, 1, 1, 1])
      const u32 = new Uint32Array(words.buffer)
      for (const field of ['size', 'rois', 'mode'] as const)
        fft[field] = [...u32.slice(FFT_PARAMS.at[field], FFT_PARAMS.at[field] + 4)]
      for (let s = 0; s < shape.lines; s++) passes.forwardRows([s, 0, 0], 0)
      for (let c = 0; c < shape.columns; c++) passes.convolveColumns([c, 0, 0], 0)
      if (shape.convolve) for (let s = 0; s < shape.lines; s++) passes.inverseRows([s, 0, 0], 0)
    },
  }
}

/** The picture `image` convolved with `kernel`, periodic, each channel divided by the sum of the
 *  channel `NORMALISED_BY` names, as the transform divides. */
function direct(image: number[][][], kernel: number[][][]) {
  const sums = [0, 1, 2, 3].map((c) => kernel.flat().reduce((sum, texel) => sum + texel[c], 0))
  const [h, w] = [image.length, image[0].length]
  const [kh, kw] = [kernel.length, kernel[0].length]
  return image.map((row, y) =>
    row.map((_, x) =>
      [0, 1, 2, 3].map((c) => {
        let sum = 0
        for (let v = 0; v < h; v++)
          for (let u = 0; u < w; u++)
            sum +=
              image[v][u][c] * kernel[(((y - v) % kh) + kh) % kh][(((x - u) % kw) + kw) % kw][c]
        return sum / sums[NORMALISED_BY[c]]
      }),
    ),
  )
}

for (const horizontalFirst of [true, false])
  test(`the transform's three passes convolve as a direct sum does, ${horizontalFirst ? 'rows' : 'columns'} first`, () => {
    const [width, height, side] = horizontalFirst ? [6, 5, 16] : [5, 6, 16]
    const image = grid(width, height, (x, y, c) => 1 + ((x * 7 + y * 3 + c * 5) % 11) / 4)
    const kernel = grid(side, side, (x, y, c) =>
      (x + y) % 5 === 0 ? 0.2 * (c + 1) + ((x * y) % 3) : 0.05 * (c + 1),
    )
    const plan = planConvolution(
      { view: [width, height], percent: 100, size: 1, bufferScale: 0 },
      { side: 4096, maxLine: 256, bytes: 2 ** 30 },
    )
    // A transform of a square of 16, the image in its corner and the kernel filling it.
    const square = {
      ...plan,
      horizontalFirst,
      frequency: [side, side] as [number, number],
      columns: side / 2 + 1,
    }
    const spectrum: number[][] = []
    transformRun(kernel, [], spectrum).run(transformShape({ ...square, image: [side, side] }, true))
    const picture = transformRun(image, spectrum, [])
    picture.run(transformShape({ ...square, image: [width, height] }, false))
    const expected = direct(image, kernel)
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++)
        for (let c = 0; c < 4; c++) {
          const got = picture.written.get(`${x},${y}`)![c]
          assert.ok(
            Math.abs(got - expected[y][x][c]) < 1e-5 * (1 + expected[y][x][c]),
            `${x},${y},${c}: ${got} against ${expected[y][x][c]}`,
          )
        }
  })

/** The kernel's passes, run over a kernel of `size` texels whose texel (x, y) holds `10 y + x`. */
function kernelRun(uniform: object, size: number) {
  const stored = new Map<string, number[]>()
  const scope = {
    kernel: uniform,
    source: 'source',
    reader: 'reader',
    held: 'held',
    drawn: 'drawn',
    textureDimensions: () => [size, size],
    textureLoad: (_: string, p: number[]) => [10 * p[1] + p[0], 0.3, -1, 7],
    textureSampleLevel: (_: string, __: string, uv: number[]) => {
      const [x, y] = uv.map((u) => Math.floor(u * size))
      return [10 * y + x, 0, 0, 0]
    },
    textureStore: (_: string, p: number[], v: number[]) => void stored.set(p.join(','), v),
  }
  return {
    stored,
    ...shaderRun<Record<'holdKernel' | 'resizeKernel', (id: number[]) => void>>(
      KERNEL_WGSL,
      ['holdKernel', 'resizeKernel'],
      scope,
    ),
  }
}

test('the kernel is held to the haze, its alpha its blue unless the chain keeps one', () => {
  const limits = {
    limit: [2, 2, 2, 3],
    dst: [0, 0, 0, 0],
    image: [0, 0, 0, 0],
    scale: [0, 0, 0, 0],
  }
  const without = kernelRun(limits, 4)
  without.holdKernel([1, 1, 0])
  assert.deepEqual(
    without.stored.get('1,1'),
    [2, 0.3, 0, 0],
    'held to [0, limit]; alpha takes the blue',
  )
  const kept = kernelRun({ ...limits, dst: [0, 0, 1, 0] }, 4)
  kept.holdKernel([0, 0, 0])
  assert.deepEqual(
    kept.stored.get('0,0'),
    [0, 0.3, 0, 3],
    'the alpha is its own, held to its own limit',
  )
})

test('the kernel is drawn at the size it has over the image, its centre at the corner, the rest wrapped', () => {
  // A 4 × 4 kernel, its centre texel (2, 2), half the width of an 8 × 8 image: a texel to a pixel.
  const uniform = {
    limit: [0, 0, 0, 0],
    dst: [8, 8, 0, 0],
    image: [8, 8, 2, 2],
    scale: [1 / 4, 1 / 4, 0.5, 0],
  }
  const run = kernelRun(uniform, 4)
  for (const [x, y] of [
    [0, 0],
    [1, 0],
    [6, 7],
    [4, 4],
  ])
    run.resizeKernel([x, y, 0])
  const value = (x: number, y: number) => run.stored.get(`${x},${y}`)![0]
  assert.equal(value(0, 0), 22, 'the centre texel lands on the pixel (0, 0)')
  assert.equal(value(1, 0), 23, 'its right neighbour on (1, 0)')
  assert.equal(value(6, 7), 10, 'two left and one above the centre is the texel (0, 1), wrapped')
  assert.equal(value(4, 4), 0, 'past the kernel, nothing')
})
