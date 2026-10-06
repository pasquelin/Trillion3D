// LDR-FLIP, a perceptual difference evaluator for alternating images: the metric a rendering
// technique is held to against its reference image. Chosen over SSIM or CIEDE2000 because it
// models what a viewer flipping between the two images sees (contrast sensitivity per opponent
// channel, then edges and points), is the metric real-time rendering reports, and needs no
// dependency: a few separable Gaussian filters, below. Checked against the metric's reference
// implementation (version 1.7) on the fixtures of `references/imageDiff.test.ts` and on random
// and structured images: same mean, each pixel within 3e-5.
import { srgbToLinear } from '../../../packages/sdk-core/src/index.ts'

type Planes = [Float32Array, Float32Array, Float32Array]

/** Pixels per degree of FLIP's default viewer: a 0.7 m wide 4K monitor seen from 0.7 m. */
const PPD = ((0.7 * 3840) / 0.7) * (Math.PI / 180)

const TO_XYZ = [
  [10135552 / 24577794, 8788810 / 24577794, 4435075 / 24577794],
  [2613072 / 12288897, 8788810 / 12288897, 887015 / 12288897],
  [1425312 / 73733382, 8788810 / 73733382, 70074185 / 73733382],
]
const TO_RGB = [
  [3.241003275, -1.537398934, -0.498615861],
  [-0.969224334, 1.875930071, 0.041554224],
  [0.055639423, -0.204011202, 1.057148933],
]
const dot = (m: number[], x: number, y: number, z: number) => m[0] * x + m[1] * y + m[2] * z
const WHITE = TO_XYZ.map((m) => dot(m, 1, 1, 1))
/** Linear value of each sRGB byte. */
const LINEAR = Float64Array.from({ length: 256 }, (_, i) => srgbToLinear(i / 255))
const [LAB_CUBE, LAB_SLOPE] = [(6 / 29) ** 3, 3 * (6 / 29) ** 2]
const labF = (t: number) => (t > LAB_CUBE ? Math.cbrt(t) : t / LAB_SLOPE + 4 / 29)

/** Linear RGB to CIELAB, then Hunt-adjusted (chroma scaled by 0.01 L), written into `out`. */
function huntLab(r: number, g: number, b: number, out: Float64Array) {
  const fx = labF(dot(TO_XYZ[0], r, g, b) / WHITE[0]),
    fy = labF(dot(TO_XYZ[1], r, g, b) / WHITE[1]),
    fz = labF(dot(TO_XYZ[2], r, g, b) / WHITE[2])
  const l = 116 * fy - 16
  out[0] = l
  out[1] = 0.01 * l * 500 * (fx - fy)
  out[2] = 0.01 * l * 200 * (fy - fz)
  return out
}
const hyab = (a: Float64Array, b: Float64Array) =>
  Math.abs(a[0] - b[0]) + Math.hypot(a[1] - b[1], a[2] - b[2])
/** The largest colour error, green against blue, and the knee of the colour error's mapping. */
const CMAX =
  hyab(huntLab(0, 1, 0, new Float64Array(3)), huntLab(0, 0, 1, new Float64Array(3))) ** 0.7
const PCCMAX = 0.4 * CMAX

/** Clamped source index of every tap position `-r .. n - 1 + r` of an axis of length `n`. */
const clampedIndices = (n: number, r: number) =>
  Int32Array.from({ length: n + 2 * r }, (_, i) => Math.min(n - 1, Math.max(0, i - r)))

/** Convolves each row of a plane by `k`, edges clamped. */
function horizontal(src: Float32Array, w: number, h: number, k: number[]) {
  const r = (k.length - 1) / 2,
    at = clampedIndices(w, r),
    out = new Float32Array(w * h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0
      for (let j = -r; j <= r; j++) s += k[j + r] * src[y * w + at[x - j + r]]
      out[y * w + x] = s
    }
  return out
}

/** Convolves each column of a plane by `k`, edges clamped. */
function vertical(src: Float32Array, w: number, h: number, k: number[]) {
  const r = (k.length - 1) / 2,
    at = clampedIndices(h, r),
    out = new Float32Array(w * h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0
      for (let j = -r; j <= r; j++) s += k[j + r] * src[at[y - j + r] * w + x]
      out[y * w + x] = s
    }
  return out
}

/** The contrast sensitivity filters of the Y, Cx and Cz channels, as `[amplitude, scale]` terms of
 *  Gaussians; every filter shares the radius of the widest one. */
const CSF: [number, number][][] = [
  [[1, 0.0047]],
  [[1, 0.0053]],
  [
    [34.1, 0.04],
    [13.5, 0.025],
  ],
]
function csf(plane: Float32Array, w: number, h: number, terms: [number, number][]) {
  const r = Math.ceil(3 * Math.sqrt(0.04 / (2 * Math.PI ** 2)) * PPD)
  const gaussians = terms.map(([a, b]) => {
    const g = Array.from({ length: 2 * r + 1 }, (_, i) =>
      Math.exp((-(Math.PI ** 2) * ((i - r) / PPD) ** 2) / b),
    )
    return { amplitude: a * Math.sqrt(Math.PI / b), g, sum: g.reduce((s, v) => s + v, 0) }
  })
  const total = gaussians.reduce((s, { amplitude, sum }) => s + amplitude * sum * sum, 0)
  const out = new Float32Array(w * h)
  for (const { amplitude, g } of gaussians) {
    const filtered = vertical(horizontal(plane, w, h, g), w, h, g),
      weight = amplitude / total
    for (let i = 0; i < out.length; i++) out[i] += weight * filtered[i]
  }
  return out
}

/** Edge (first derivative) and point (second derivative) detectors of the feature pipeline, split
 *  as `k(x) · g(y)`, positive weights summing to 1 and negative ones to -1. */
function detectors() {
  const sd = 0.5 * 0.082 * PPD,
    r = Math.ceil(3 * sd)
  const g = Array.from({ length: 2 * r + 1 }, (_, i) => Math.exp(-((i - r) ** 2) / (2 * sd * sd)))
  const gSum = g.reduce((s, v) => s + v, 0)
  const normalise = (k: number[]) => {
    const pos = k.reduce((s, v) => s + Math.max(v, 0), 0),
      neg = -k.reduce((s, v) => s + Math.min(v, 0), 0)
    return k.map((v) => v / ((v < 0 ? neg : pos) * gSum))
  }
  const edge = normalise(g.map((v, i) => -(i - r) * v))
  const point = normalise(g.map((v, i) => (((i - r) / sd) ** 2 - 1) * v))
  return { g, edge, point }
}
const DETECTORS = detectors()

/** The edge and point strengths of a normalised luminance plane: the gradient norms of its
 *  derivative-of-Gaussian responses along x and y. */
function features(y: Float32Array, w: number, h: number) {
  const { g, edge, point } = DETECTORS,
    smoothX = horizontal(y, w, h, g)
  const norm = (k: number[]) => {
    const kx = vertical(horizontal(y, w, h, k), w, h, g),
      ky = vertical(smoothX, w, h, k)
    for (let i = 0; i < kx.length; i++) kx[i] = Math.hypot(kx[i], ky[i])
    return kx
  }
  return { edges: norm(edge), points: norm(point) }
}

/** Opponent YCxCz planes of an sRGB RGBA8 image, and its normalised luminance. */
function opponent(body: Uint8Array, n: number) {
  const [luminance, ...planes] = Array.from({ length: 4 }, () => new Float32Array(n))
  for (let p = 0; p < n; p++) {
    const r = LINEAR[body[p * 4]],
      g = LINEAR[body[p * 4 + 1]],
      b = LINEAR[body[p * 4 + 2]]
    const x = dot(TO_XYZ[0], r, g, b) / WHITE[0],
      y = dot(TO_XYZ[1], r, g, b) / WHITE[1],
      z = dot(TO_XYZ[2], r, g, b) / WHITE[2]
    planes[0][p] = 116 * y - 16
    planes[1][p] = 500 * (x - y)
    planes[2][p] = 200 * (y - z)
    luminance[p] = (planes[0][p] + 16) / 116
  }
  return { planes: planes as Planes, luminance }
}

/** The Hunt-adjusted CIELAB of pixel `p` of filtered YCxCz planes, the colour clamped to [0, 1]. */
function filteredLab([yy, cx, cz]: Planes, p: number, out: Float64Array) {
  const yn = (yy[p] + 16) / 116,
    x = (yn + cx[p] / 500) * WHITE[0],
    y = yn * WHITE[1],
    z = (yn - cz[p] / 200) * WHITE[2]
  const unit = (v: number) => Math.min(1, Math.max(0, v))
  return huntLab(
    unit(dot(TO_RGB[0], x, y, z)),
    unit(dot(TO_RGB[1], x, y, z)),
    unit(dot(TO_RGB[2], x, y, z)),
    out,
  )
}

/** The per-pixel LDR-FLIP error of `test` against `reference`, both sRGB RGBA8 of `w × h`, in
 *  [0, 1]; alpha is not read. */
export function flipMap(reference: Uint8Array, test: Uint8Array, w: number, h: number) {
  const n = w * h,
    ref = opponent(reference, n),
    tst = opponent(test, n)
  const [fr, ft] = [ref, tst].map(
    ({ planes }) => planes.map((p, c) => csf(p, w, h, CSF[c])) as Planes,
  )
  const featRef = features(ref.luminance, w, h),
    featTst = features(tst.luminance, w, h)
  const labRef = new Float64Array(3),
    labTst = new Float64Array(3),
    out = new Float32Array(n)
  for (let p = 0; p < n; p++) {
    const e = hyab(filteredLab(fr, p, labRef), filteredLab(ft, p, labTst)) ** 0.7
    const colour = e < PCCMAX ? (0.95 / PCCMAX) * e : 0.95 + ((e - PCCMAX) / (CMAX - PCCMAX)) * 0.05
    const feature = Math.max(
      Math.abs(featRef.edges[p] - featTst.edges[p]),
      Math.abs(featRef.points[p] - featTst.points[p]),
    )
    out[p] = colour ** (1 - Math.sqrt(feature / Math.SQRT2))
  }
  return out
}
