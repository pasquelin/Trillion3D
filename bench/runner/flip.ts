// LDR-FLIP (Andersson et al., "FLIP: A Difference Evaluator for Alternating Images", NVIDIA, HPG
// 2020): the perceptual metric a rendering technique is held to against its reference image (#1280).
// Chosen over SSIM or CIEDE2000 because it models what a viewer flipping between the two images
// sees (contrast sensitivity per opponent channel, then edges and points), is the metric real-time
// rendering papers report, and needs no dependency: a few separable Gaussian filters, below.
// Checked against NVIDIA's `flip-evaluator` 1.6 on the fixtures of `imageDiff.test.ts`.

type Vec3 = [number, number, number];
type Planes = [Float32Array, Float32Array, Float32Array];

/** Pixels per degree of FLIP's default viewer: a 0.7 m wide 4K monitor seen from 0.7 m. */
const FLIP_PPD = ((0.7 * 3840) / 0.7) * (Math.PI / 180);

const TO_XYZ = [
  [10135552 / 24577794, 8788810 / 24577794, 4435075 / 24577794],
  [2613072 / 12288897, 8788810 / 12288897, 887015 / 12288897],
  [1425312 / 73733382, 8788810 / 73733382, 70074185 / 73733382],
];
const TO_RGB = [
  [3.241003275, -1.537398934, -0.498615861],
  [-0.969224334, 1.875930071, 0.041554224],
  [0.055639423, -0.204011202, 1.057148933],
];
const mul = (m: number[][], [x, y, z]: Vec3): Vec3 =>
  m.map((r) => r[0] * x + r[1] * y + r[2] * z) as Vec3;
const WHITE = mul(TO_XYZ, [1, 1, 1]);
const linear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/** Linear RGB to CIELAB, then Hunt-adjusted: chroma scaled by 0.01 L. */
function huntLab(rgb: Vec3): Vec3 {
  const f = mul(TO_XYZ, rgb).map((v, i) => {
    const t = v / WHITE[i];
    return t > (6 / 29) ** 3 ? Math.cbrt(t) : t / (3 * (6 / 29) ** 2) + 4 / 29;
  });
  const l = 116 * f[1] - 16;
  return [l, 0.01 * l * 500 * (f[0] - f[1]), 0.01 * l * 200 * (f[1] - f[2])];
}
const hyab = (a: Vec3, b: Vec3) => Math.abs(a[0] - b[0]) + Math.hypot(a[1] - b[1], a[2] - b[2]);

/** Convolves a plane by a separable kernel `kx(x) · ky(y)`, edges clamped. */
function separable(src: Float32Array, w: number, h: number, kx: number[], ky: number[]) {
  const r = (kx.length - 1) / 2,
    tmp = new Float32Array(w * h),
    out = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let k = -r; k <= r; k++)
        s += kx[k + r] * src[y * w + Math.min(w - 1, Math.max(0, x - k))];
      tmp[y * w + x] = s;
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let k = -r; k <= r; k++)
        s += ky[k + r] * tmp[Math.min(h - 1, Math.max(0, y - k)) * w + x];
      out[y * w + x] = s;
    }
  return out;
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
];
function csf(plane: Float32Array, w: number, h: number, terms: [number, number][], ppd: number) {
  const r = Math.ceil(3 * Math.sqrt(0.04 / (2 * Math.PI ** 2)) * ppd);
  const gaussians = terms.map(([a, b]) => {
    const g = Array.from({ length: 2 * r + 1 }, (_, i) =>
      Math.exp((-(Math.PI ** 2) * ((i - r) / ppd) ** 2) / b),
    );
    return { amplitude: a * Math.sqrt(Math.PI / b), g, sum: g.reduce((s, v) => s + v, 0) };
  });
  const total = gaussians.reduce((s, { amplitude, sum }) => s + amplitude * sum * sum, 0);
  const out = new Float32Array(w * h);
  for (const { amplitude, g } of gaussians) {
    const filtered = separable(plane, w, h, g, g);
    for (let i = 0; i < out.length; i++) out[i] += (amplitude / total) * filtered[i];
  }
  return out;
}

/** Edge (first derivative) and point (second derivative) detectors of the feature pipeline, split
 *  as `k(x) · g(y)`, positive weights summing to 1 and negative ones to -1. */
function detectors(ppd: number) {
  const sd = 0.5 * 0.082 * ppd,
    r = Math.ceil(3 * sd);
  const g = Array.from({ length: 2 * r + 1 }, (_, i) => Math.exp(-((i - r) ** 2) / (2 * sd * sd)));
  const gSum = g.reduce((s, v) => s + v, 0);
  const normalise = (k: number[]) => {
    const pos = k.reduce((s, v) => s + Math.max(v, 0), 0),
      neg = -k.reduce((s, v) => s + Math.min(v, 0), 0);
    return k.map((v) => v / ((v < 0 ? neg : pos) * gSum));
  };
  const edge = normalise(g.map((v, i) => -(i - r) * v));
  const point = normalise(g.map((v, i) => (((i - r) / sd) ** 2 - 1) * v));
  return { g, edge, point };
}

/** Opponent YCxCz planes of an sRGB RGBA8 image. */
function opponent(body: Uint8Array, n: number): Planes {
  const planes: Planes = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  for (let p = 0; p < n; p++) {
    const xyz = mul(TO_XYZ, [0, 1, 2].map((c) => linear(body[p * 4 + c] / 255)) as Vec3);
    const [x, y, z] = xyz.map((v, i) => v / WHITE[i]);
    planes[0][p] = 116 * y - 16;
    planes[1][p] = 500 * (x - y);
    planes[2][p] = 200 * (y - z);
  }
  return planes;
}

/** The per-pixel LDR-FLIP error of `test` against `reference`, both sRGB RGBA8 of `w × h`, in
 *  [0, 1]; alpha is not read. */
export function flipMap(
  reference: Uint8Array,
  test: Uint8Array,
  w: number,
  h: number,
  ppd = FLIP_PPD,
) {
  const n = w * h,
    ref = opponent(reference, n),
    tst = opponent(test, n);
  const [fr, ft] = [ref, tst].map((planes) => planes.map((p, c) => csf(p, w, h, CSF[c], ppd)));
  const { g, edge, point } = detectors(ppd);
  const features = (planes: Planes) => {
    const y = planes[0].map((v) => (v + 16) / 116);
    const norm = (k: number[]) => {
      const kx = separable(y, w, h, k, g),
        ky = separable(y, w, h, g, k);
      return kx.map((v, i) => Math.hypot(v, ky[i]));
    };
    return { edges: norm(edge), points: norm(point) };
  };
  const [featRef, featTst] = [features(ref), features(tst)];
  const cmax = hyab(huntLab([0, 1, 0]), huntLab([0, 0, 1])) ** 0.7,
    pccmax = 0.4 * cmax;
  const lab = (f: Float32Array[], p: number) => {
    const [yy, cx, cz] = [f[0][p], f[1][p], f[2][p]];
    const yn = (yy + 16) / 116;
    const rgb = mul(TO_RGB, [
      (yn + cx / 500) * WHITE[0],
      yn * WHITE[1],
      (yn - cz / 200) * WHITE[2],
    ]);
    return huntLab(rgb.map((v) => Math.min(1, Math.max(0, v))) as Vec3);
  };
  const out = new Float32Array(n);
  for (let p = 0; p < n; p++) {
    const e = hyab(lab(fr, p), lab(ft, p)) ** 0.7;
    const colour =
      e < pccmax ? (0.95 / pccmax) * e : 0.95 + ((e - pccmax) / (cmax - pccmax)) * 0.05;
    const feature = Math.max(
      Math.abs(featRef.edges[p] - featTst.edges[p]),
      Math.abs(featRef.points[p] - featTst.points[p]),
    );
    out[p] = colour ** (1 - (feature / Math.SQRT2) ** 0.5);
  }
  return out;
}
