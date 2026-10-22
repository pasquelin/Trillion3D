/**
 * The frequency content of a blue-noise mask, for the tests: its power at each distance from the origin of an image's spectrum
 * (`spatialSpectrum`) and at each frequency along the frames of a pixel (`temporalSpectrum`), both over what white noise of
 * the same variance would hold — 1 — so that a mask without low frequencies reads near 0 there and a mask rich in high ones above
 * 1 there.
 */

/** The discrete Fourier transform of `re + i·im` in place, their length a power of two (the iterative radix-2 transform). */
function transform(re: Float64Array, im: Float64Array) {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      ;[re[i], re[j]] = [re[j], re[i]]
      ;[im[i], im[j]] = [im[j], im[i]]
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const angle = (-2 * Math.PI) / size
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < size / 2; k++) {
        const wr = Math.cos(angle * k),
          wi = Math.sin(angle * k)
        const a = start + k,
          b = a + size / 2
        const tr = re[b] * wr - im[b] * wi,
          ti = re[b] * wi + im[b] * wr
        re[b] = re[a] - tr
        im[b] = im[a] - ti
        re[a] += tr
        im[a] += ti
      }
    }
  }
}

/** The mean and variance of `values`. */
function moments(values: ArrayLike<number>) {
  let sum = 0,
    squares = 0
  for (let i = 0; i < values.length; i++) {
    sum += values[i]
    squares += values[i] * values[i]
  }
  const mean = sum / values.length
  return { mean, variance: squares / values.length - mean * mean }
}

/** The power of the `side × side` image of `mask` at `offset`: its spectrum (its mean taken out) at each distance `0 … side / 2` from the origin, in white noise's. */
function imagePower(mask: ArrayLike<number>, offset: number, side: number, mean: number) {
  const re = new Float64Array(side * side),
    im = new Float64Array(side * side)
  for (let i = 0; i < re.length; i++) re[i] = mask[offset + i] - mean
  const lineRe = new Float64Array(side),
    lineIm = new Float64Array(side)
  for (let pass = 0; pass < 2; pass++) {
    for (let line = 0; line < side; line++) {
      for (let k = 0; k < side; k++) {
        const at = pass === 0 ? line * side + k : k * side + line
        lineRe[k] = re[at]
        lineIm[k] = im[at]
      }
      transform(lineRe, lineIm)
      for (let k = 0; k < side; k++) {
        const at = pass === 0 ? line * side + k : k * side + line
        re[at] = lineRe[k]
        im[at] = lineIm[k]
      }
    }
  }
  const sums = new Float64Array(side / 2 + 1),
    counts = new Float64Array(side / 2 + 1)
  for (let fy = 0; fy < side; fy++)
    for (let fx = 0; fx < side; fx++) {
      const distance = Math.round(Math.hypot(Math.min(fx, side - fx), Math.min(fy, side - fy)))
      if (distance > side / 2) continue
      sums[distance] += re[fy * side + fx] ** 2 + im[fy * side + fx] ** 2
      counts[distance]++
    }
  return sums.map((sum, d) => sum / counts[d])
}

/**
 * The spatial spectrum of the frames `frames` of a mask of `side × side` pixels: the power at each distance `0 … side / 2` from the origin,
 * averaged over the frames, over white noise's (the variance of the whole mask times the pixels of an image).
 */
export function spatialSpectrum(mask: ArrayLike<number>, side: number, frames: readonly number[]) {
  const { mean, variance } = moments(mask)
  const sum = new Float64Array(side / 2 + 1)
  for (const frame of frames) {
    const power = imagePower(mask, frame * side * side, side, mean)
    for (let d = 0; d < sum.length; d++) sum[d] += power[d]
  }
  return sum.map((power) => power / frames.length / (variance * side * side))
}

/**
 * The temporal spectrum of a mask of `side × side` pixels and `depth` frames: the power at each frequency `0 … depth / 2` of the frames of
 * every `stride`-th pixel along both axes, averaged, over white noise's (the variance of the whole mask times the frames).
 */
export function temporalSpectrum(
  mask: ArrayLike<number>,
  side: number,
  depth: number,
  stride: number,
) {
  const { mean, variance } = moments(mask)
  const sums = new Float64Array(depth / 2 + 1)
  let series = 0
  const re = new Float64Array(depth),
    im = new Float64Array(depth)
  for (let y = 0; y < side; y += stride)
    for (let x = 0; x < side; x += stride) {
      for (let z = 0; z < depth; z++) {
        re[z] = mask[(z * side + y) * side + x] - mean
        im[z] = 0
      }
      transform(re, im)
      for (let k = 0; k < sums.length; k++) sums[k] += re[k] ** 2 + im[k] ** 2
      series++
    }
  return sums.map((power) => power / series / (variance * depth))
}

/** The mean of `spectrum` over the frequencies `from … to`. */
export const bandMean = (spectrum: ArrayLike<number>, from: number, to: number) => {
  let sum = 0
  for (let k = from; k <= to; k++) sum += spectrum[k]
  return sum / (to - from + 1)
}
