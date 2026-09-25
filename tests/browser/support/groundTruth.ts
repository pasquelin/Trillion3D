// The ground truth of a grazing material fixture (#443): the view the renderers draw, cast on the
// CPU from each pixel's centre into the fixture's square and the square behind it. Along the axis
// the map is minified — the pixel's texture footprint, the screen axis that spans more texels, on
// the tangent the exact derivatives lay at the pixel's centre, as a sampler reads it —
// `SAMPLES` reads of the base level are averaged in linear light, bilinear across it as a
// magnification reads; the alpha cutoff then applies once, to that filtered alpha, as a pixel's
// alpha test does. No mip level and no footprint cap: what a perfect anisotropic sampler returns,
// the reference both engines are judged against. A magnified axis is never averaged: that would
// be antialiasing, which no sampler does.
//
// A renderer's gap to it is counted as the measurer counts one (#443): pixels farther than one
// 8-bit level on a channel. A pixel a silhouette crosses is not counted: the renderers draw it
// with one sample, and which surface it shows is geometry. Pure: served to the harness page
// (`materialTruth.ts`) and run in Node by its unit test.
import { Matrix4 } from '../../../packages/sdk-core/src/world/math/matrix4.ts';
import { Vector3 } from '../../../packages/sdk-core/src/world/math/vector3.ts';
import { Color } from '../../../packages/sdk-core/src/world/math/color.ts';
import {
  linearToSrgb8,
  srgbToLinear,
} from '../../../packages/sdk-core/src/math/primitives/color.ts';
import { wrapLinear } from '../../../packages/sdk-browser/src/visibility/wrapModes.ts';

/** Reads along the minified axis of a pixel: converged to within one level on the foliage. */
const SAMPLES = 32;

/** A map as the square wears it: RGBA8 texels, row 0 at v = 0, addressed by repeat. */
interface TruthMap {
  data: ArrayLike<number>;
  width: number;
  height: number;
  /** Whether its colours are sRGB-encoded, decoded before they are mixed. */
  srgb: boolean;
  /** Its UV transform, a 3×3 matrix column-major (`GraphTexture.matrix`). */
  uv: ArrayLike<number>;
}

/** A square facing +z in its own frame, of half-side `half`, placed in the world by `place`. */
interface TruthSquare {
  place: Matrix4;
  half: number;
}

/** One fixture's view: a white unlit square wearing `map`, over the square `behind` of its colour
 *  when it declares one, over `clear` elsewhere. */
export interface TruthView {
  size: number;
  camera: { projectionMatrix: Matrix4; matrixWorldInverse: Matrix4; matrixWorld: Matrix4 };
  square: TruthSquare;
  map: TruthMap;
  /** Alpha under which the pixel shows what is behind the square; 0 keeps every pixel. */
  alphaTest: number;
  behind?: TruthSquare & { colour: number };
  clear: number;
}

/** The truth, a bottom-left RGBA8 image, and the pixels a silhouette crosses (1). */
export interface Truth {
  rgba: Uint8Array;
  edge: Uint8Array;
}

/** A renderer's gap to the truth: pixels farther than the level allowed, and the largest gap. */
export type TruthGap = { pixels: number; max: number };

/** Adds `w` times the linear RGBA of the map at `(u, v)` into `out`, bilinear and repeated
 *  as the CPU mirror of the samplers reads it (`wrapLinear`). */
function bilinear(
  map: TruthMap,
  linear: Float32Array,
  u: number,
  v: number,
  w: number,
  out: Float64Array,
) {
  const [x0, x1, wx] = wrapLinear(u, map.width, 'repeat'),
    [y0, y1, wy] = wrapLinear(v, map.height, 'repeat');
  const r0 = y0 * map.width * 4,
    r1 = y1 * map.width * 4;
  for (let k = 0; k < 4; k++)
    out[k] +=
      w *
      ((1 - wy) * ((1 - wx) * linear[r0 + x0 * 4 + k] + wx * linear[r0 + x1 * 4 + k]) +
        wy * ((1 - wx) * linear[r1 + x0 * 4 + k] + wx * linear[r1 + x1 * 4 + k]));
}

/** A square's plane seen from the screen: the inverse of its projection, a homography built once.
 *  The function writes into `at` the plane point under NDC `(x, y)`, into `slope` its derivatives
 *  along NDC x then y — exact, as the engine's (`uvGradients`) —, and says whether it lies on the
 *  square's front face, in front of the eye. */
function onSquare({ camera }: TruthView, { place, half }: TruthSquare) {
  const f = new Matrix4()
    .multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    .multiply(place).elements;
  // The plane z = 0 keeps columns 0, 1 and 3; the depth row is left out, an identity there.
  // prettier-ignore
  const g = new Matrix4().set(
    f[0], f[4], 0, f[12], f[1], f[5], 0, f[13],
    0, 0, 1, 0, f[3], f[7], 0, f[15],
  ).invert().elements;
  const eye = new Vector3(0, 0, 0).applyMatrix4(
    place.clone().invert().multiply(camera.matrixWorld),
  );
  return (x: number, y: number, at: { x: number; y: number }, slope: number[]) => {
    const w = g[3] * x + g[7] * y + g[15];
    at.x = (g[0] * x + g[4] * y + g[12]) / w;
    at.y = (g[1] * x + g[5] * y + g[13]) / w;
    for (const i of [0, 1]) {
      slope[2 * i] = (g[4 * i] - at.x * g[4 * i + 3]) / w;
      slope[2 * i + 1] = (g[4 * i + 1] - at.y * g[4 * i + 3]) / w;
    }
    return eye.z > 0 && w > 0 && Math.abs(at.x) <= half && Math.abs(at.y) <= half;
  };
}

/** Renders `view`, `samples` reads a pixel along its minified axis. */
export function groundTruth(view: TruthView, samples = SAMPLES): Truth {
  const { size, map, square } = view;
  const linear = Float32Array.from(map.data, (value, i) =>
    map.srgb && i % 4 !== 3 ? srgbToLinear(value / 255) : value / 255,
  );
  const front = onSquare(view, square),
    back = view.behind && onSquare(view, view.behind);
  const [behind, clear] = [view.behind?.colour ?? 0, view.clear].map((hex) =>
    new Color(hex).toArray(),
  );
  const at = { x: 0, y: 0 },
    slope = [0, 0, 0, 0],
    sum = new Float64Array(4),
    e = map.uv,
    halfPixel = 1 / size,
    // The square's plane point to its UV, `(p / half + 1) / 2`: this much per plane unit.
    toUv = 1 / (2 * square.half);
  const truth: Truth = { rgba: new Uint8Array(size * size * 4), edge: new Uint8Array(size * size) };
  /** The surface the geometry shows at `(x, y)`: 1 the square, 2 the one behind, 0 none. */
  const surfaceAt = (x: number, y: number) =>
    front(x, y, at, slope) ? 1 : back?.(x, y, at, slope) ? 2 : 0;
  /** A plane point (`w` 1) or move (`w` 0) `(a, b)` on the map, through its UV transform. */
  const onMap = (a: number, b: number, w: number) => [
    e[0] * a + e[3] * b + e[6] * w,
    e[1] * a + e[4] * b + e[7] * w,
  ];
  /** Texels spanned, squared, by a map move. */
  const texels = ([du, dv]: number[]) => (du * map.width) ** 2 + (dv * map.height) ** 2;
  for (let py = 0; py < size; py++)
    for (let px = 0; px < size; px++) {
      const index = py * size + px,
        x = (2 * px + 1) * halfPixel - 1,
        y = (2 * py + 1) * halfPixel - 1;
      const surface = surfaceAt(x, y);
      let colour: ArrayLike<number> | undefined;
      if (surface === 1) {
        const [u, v] = onMap(at.x * toUv + 0.5, at.y * toUv + 0.5, 1);
        // The pixel's footprint on the map, one pixel along each screen axis, on the tangent at
        // its centre as a sampler's derivatives lay it — the curve a pixel's edges trace departs
        // from it, and no sampler follows that curve.
        const step = 2 * halfPixel * toUv,
          across = onMap(slope[0] * step, slope[1] * step, 0),
          up = onMap(slope[2] * step, slope[3] * step, 0);
        const [lx, ly] = [texels(across), texels(up)];
        // A footprint of one texel or less is magnified: one read, as the sampler's.
        const reads = Math.max(lx, ly) > 1 ? samples : 1,
          [du, dv] = lx >= ly ? across : up;
        sum.fill(0);
        for (let s = 0; s < reads; s++) {
          const t = (s + 0.5) / reads - 0.5;
          bilinear(map, linear, u + du * t, v + dv * t, 1 / reads, sum);
        }
        if (sum[3] >= view.alphaTest) colour = sum;
      }
      // Under the cutoff, or off the square: the square behind, or the clear colour.
      colour ??= back?.(x, y, at, slope) ? behind : clear;
      // A silhouette crossing the pixel changes the surface at one of its corners.
      for (const cx of [-1, 1])
        for (const cy of [-1, 1])
          if (surfaceAt(x + cx * halfPixel, y + cy * halfPixel) !== surface) truth.edge[index] = 1;
      for (let k = 0; k < 3; k++) truth.rgba[index * 4 + k] = linearToSrgb8(colour[k]);
      truth.rgba[index * 4 + 3] = 255;
    }
  return truth;
}

/** The gap of a bottom-left RGBA8 `image` to the truth: pixels farther than one level on a
 *  channel, silhouettes aside, and the largest gap there. */
export function truthGap(image: ArrayLike<number>, truth: Truth): TruthGap {
  // A short image — no frame read — would compare as NaN and count as no gap.
  if (image.length < truth.rgba.length)
    throw new Error(`image of ${image.length} bytes, the truth holds ${truth.rgba.length}`);
  const gap: TruthGap = { pixels: 0, max: 0 };
  for (let pixel = 0; pixel < truth.edge.length; pixel++) {
    if (truth.edge[pixel]) continue;
    let most = 0;
    for (let k = 0; k < 3; k++)
      most = Math.max(most, Math.abs(image[pixel * 4 + k] - truth.rgba[pixel * 4 + k]));
    gap.max = Math.max(gap.max, most);
    if (most > 1) gap.pixels++;
  }
  return gap;
}

/** The proof of #443: the engine within `tolerance` pixels of the truth, and no farther from it
 *  than the witness. Undefined when it holds, else what fails. */
export function truthVerdict(engine: TruthGap, reference: TruthGap, tolerance: number) {
  const gap = `engine ${engine.pixels} px from the ground truth`;
  if (engine.pixels > tolerance) return `${gap}, tolerance ${tolerance} px`;
  if (engine.pixels > reference.pixels)
    return `${gap}, farther than the witness's ${reference.pixels} px`;
}
