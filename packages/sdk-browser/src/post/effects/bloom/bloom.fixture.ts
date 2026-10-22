import type { BloomKernelImage } from '../../../../../sdk-core/src/contracts/bloomConvolutionOptions.ts'
import { wordViews } from '../../../gpu/core/wordViews.ts'
import { bilinearRead } from '../../../materials/texture/bilinear.fixture.ts'
import { shaderRun } from '../../../materials/texture/shaderRun.fixture.ts'
import { FFT_PARAMS, fftShader } from './convolution/fftWgsl.ts'
import { writeTransformWords, type TransformShape } from './convolution/transformShape.ts'
import { twiddleTable } from './convolution/twiddles.ts'

/**
 * The oracles of the bloom's blur, rebuilt from its definition rather than from the engine's
 * kernel: the weight of each texel of a Gaussian of a radius, and what a list of bilinear reads
 * weighs each texel it touches.
 */

/** The weight of each texel `−reach … +reach` of the Gaussian of `radius` texels, `exp(−16.7
 *  (x / radius)²)` normalised to 1, `reach` the radius rounded up and held to 31, the radius
 *  itself held to 31 as well. */
export function bellOf(radius: number) {
  const sigma = Math.min(radius, 31),
    reach = Math.min(Math.ceil(sigma), 31)
  const weights = new Map<number, number>()
  let sum = 0
  for (let x = -reach; x <= reach; x++) {
    const weight = Math.exp(-16.7 * (x / sigma) ** 2)
    weights.set(x, weight)
    sum += weight
  }
  for (const [x, weight] of weights) weights.set(x, weight / sum)
  return weights
}

/** What `count` reads of `offsets` and `weights` weigh each texel they touch: a read at `o` takes
 *  `1 − t` of the texel `⌊o⌋` and `t` of the next, `t` the fraction of `o`, as a bilinear sampler
 *  does. */
export function texelsOf(offsets: ArrayLike<number>, weights: ArrayLike<number>, count: number) {
  const texels = new Map<number, number>()
  const add = (x: number, weight: number) => texels.set(x, (texels.get(x) ?? 0) + weight)
  for (let i = 0; i < count; i++) {
    const at = Math.floor(offsets[i]),
      t = offsets[i] - at
    add(at, weights[i] * (1 - t))
    if (t) add(at + 1, weights[i] * t)
  }
  return texels
}

/** A grid of one channel, row by row. */
export type Image = { data: Float64Array; w: number; h: number }

/** The sampler's bilinear read of `image` at texel coordinates `(x, y)`, clamped to its edge. */
export const bilinear = ({ data, w, h }: Image, x: number, y: number) =>
  bilinearRead((i, j) => data[j * w + i], w, h, x, y)

/** An `rgba16float` target's store of `x`: the nearest half, ties to even, ±Inf from 65520 on,
 *  NaN and the zeros' sign kept (`Math.f16round`, missing from Node 22). */
export function f16(x: number) {
  const a = Math.abs(x)
  if (!Number.isFinite(x)) return x
  if (a >= 65520) return Math.sign(x) * Infinity
  let e = Math.max(-14, Math.floor(Math.log2(a || 1)))
  if (2 ** e > a && e > -14) e--
  const step = 2 ** (e - 10),
    n = a / step,
    floor = Math.floor(n)
  const up = n - floor > 0.5 || (n - floor === 0.5 && floor % 2 === 1)
  return (x < 0 || Object.is(x, -0) ? -1 : 1) * (up ? floor + 1 : floor) * step
}

/** `rows` of `columns` texels of four channels, each `value(x, y, channel)`. */
export const texelGrid = (
  columns: number,
  rows: number,
  value: (x: number, y: number, c: number) => number,
) =>
  Array.from({ length: rows }, (_, y) =>
    Array.from({ length: columns }, (_, x) => [0, 1, 2, 3].map((c) => value(x, y, c))),
  )

/** A kernel of `side` × `side` texels a host could give: its centre the brightest texel, a haze
 *  that falls with the distance from it, and a colour — the green and the blue weigh less than the
 *  red, each a different share, so a channel taken for another shows. */
export function testKernel(side = 32): BloomKernelImage {
  const pixels = new Float32Array(4 * side * side)
  const half = side / 2
  for (let y = 0; y < side; y++)
    for (let x = 0; x < side; x++) {
      const haze = 0.05 / (1 + Math.hypot(x - half, y - half) ** 2)
      const light = x === half && y === half ? 100 : haze
      pixels.set([light, 0.7 * light, 0.4 * light, light], 4 * (y * side + x))
    }
  return { width: side, height: side, pixels }
}

/**
 * The shipped transform's passes over `shape` (`convolution/fftWgsl.ts`), one thread standing for the
 * workgroup, lines of 256 values: the rows of the picture `texels`, then the columns — each channel
 * times the kernel's spectrum `kernel` where the shape convolves —, then, there, the rows back, the
 * glow stored by texel, each channel times `scale`. `planes` is where the spectrum lies: the kernel's,
 * once made, is the next one's `kernel`. The boost of the bright pixels is off.
 */
export function transformed(
  texels: number[][][],
  kernel: number[][],
  planes: number[][],
  shape: TransformShape,
  scale = [1, 1, 1, 1],
) {
  const [table, written, words] = [
    twiddleTable(256),
    new Map<string, number[]>(),
    wordViews(new ArrayBuffer(FFT_PARAMS.words * 4)),
  ]
  writeTransformWords(words, shape, scale)
  const at = FFT_PARAMS.at
  const field = (name: 'size' | 'rois' | 'mode') => [...words.u.slice(at[name], at[name] + 4)]
  const run = shaderRun<Record<string, (at: number[], lane: number) => void>>(
    fftShader(256),
    ['forwardRows', 'convolveColumns', 'inverseRows'],
    {
      LANES: 1,
      reverseBits: (x: number) =>
        parseInt([...Array(32)].map((_, b) => (x >>> b) & 1).join(''), 2) >>> 0,
      workgroupBarrier: () => undefined,
      fft: {
        size: field('size'),
        rois: field('rois'),
        mode: field('mode'),
        lift: [0, 0, 0, 1],
        scale: [...words.f.slice(at.scale, at.scale + 4)],
      },
      source: 's',
      planes,
      kernelPlanes: kernel,
      factors: Array.from({ length: 128 }, (_, k) => [table[2 * k], table[2 * k + 1]]),
      glowOut: 'o',
      waves: Array.from({ length: 256 }, () => [0, 0]),
      textureLoad: (_: string, p: number[]) => texels[p[1]][p[0]],
      textureStore: (_: string, p: number[], v: number[]) => void written.set(p.join(','), v),
    },
  )
  for (let s = 0; s < shape.lines; s++) run.forwardRows([s, 0, 0], 0)
  for (let c = 0; c < shape.columns; c++) run.convolveColumns([c, 0, 0], 0)
  if (shape.convolve) for (let s = 0; s < shape.lines; s++) run.inverseRows([s, 0, 0], 0)
  return written
}

/** The picture `image` convolved with `kernel` by the definition, periodic over the kernel's side,
 *  (its rows and columns whatever they are) each channel divided by the sum of its own kernel
 *  channel, as the transform divides. */
export function convolvedBySum(image: number[][][], kernel: number[][][]) {
  const [rows, columns] = [kernel.length, kernel[0].length]
  const sums = [0, 1, 2, 3].map((c) => kernel.flat().reduce((sum, texel) => sum + texel[c], 0))
  return image.map((row, y) =>
    row.map((_, x) =>
      [0, 1, 2, 3].map((c) => {
        let sum = 0
        for (let v = 0; v < image.length; v++)
          for (let u = 0; u < row.length; u++)
            sum += image[v][u][c] * kernel[(y - v + rows) % rows][(x - u + columns) % columns][c]
        return sum / sums[c]
      }),
    ),
  )
}
