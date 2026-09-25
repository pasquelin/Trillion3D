// The ground truth of a grazing material fixture (#443): the view the renderers draw, cast on the
// CPU from each pixel's centre into the fixture's square and the square behind it. Along the axis
// the map is minified — the pixel's texture footprint, the screen axis that spans more texels —
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
/** The pixel's corners, `x, y` in half-pixels from its centre: a silhouette changes one. */
const CORNERS = [-1, -1, 1, -1, -1, 1, 1, 1];

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
export interface TruthSquare {
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

/** Linear RGB then alpha of the map at `(u, v)`, bilinear and repeated as the CPU mirror of the
 *  samplers reads it (`wrapLinear`), into `out`. */
function bilinear(map: TruthMap, linear: Float32Array, u: number, v: number, out: Float64Array) {
  const [x0, x1, wx] = wrapLinear(u, map.width, 'repeat'),
    [y0, y1, wy] = wrapLinear(v, map.height, 'repeat');
  const [a, b, c, d] = [
    y0 * map.width + x0,
    y0 * map.width + x1,
    y1 * map.width + x0,
    y1 * map.width + x1,
  ];
  for (let k = 0; k < 4; k++)
    out[k] =
      (1 - wy) * ((1 - wx) * linear[a * 4 + k] + wx * linear[b * 4 + k]) +
      wy * ((1 - wx) * linear[c * 4 + k] + wx * linear[d * 4 + k]);
}

/** A square's plane seen from the screen: the inverse of its projection, a homography built once.
 *  The function writes into `at` the plane point under NDC `(x, y)` and says whether it lies on
 *  the square's front face, in front of the eye. */
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
  return (x: number, y: number, at: { x: number; y: number }) => {
    const w = g[3] * x + g[7] * y + g[15];
    at.x = (g[0] * x + g[4] * y + g[12]) / w;
    at.y = (g[1] * x + g[5] * y + g[13]) / w;
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
    uv = [0, 0],
    texel = new Float64Array(4),
    sum = new Float64Array(4),
    e = map.uv,
    half = 1 / size;
  const truth: Truth = { rgba: new Uint8Array(size * size * 4), edge: new Uint8Array(size * size) };
  /** The surface the geometry shows at `(x, y)`: 1 the square, 2 the one behind, 0 none. */
  const surfaceAt = (x: number, y: number) => (front(x, y, at) ? 1 : back?.(x, y, at) ? 2 : 0);
  /** The map's coordinate at `(x, y)` on the square's plane, in `uv`. */
  const mapAt = (x: number, y: number) => {
    front(x, y, at);
    const u = (at.x / square.half + 1) / 2,
      v = (at.y / square.half + 1) / 2;
    uv[0] = e[0] * u + e[3] * v + e[6];
    uv[1] = e[1] * u + e[4] * v + e[7];
    return uv;
  };
  /** Texels spanned, squared, from `(x, y) - (dx, dy)` to `(x, y) + (dx, dy)`. */
  const span = (x: number, y: number, dx: number, dy: number) => {
    const [u0, v0] = mapAt(x - dx, y - dy);
    const [u1, v1] = mapAt(x + dx, y + dy);
    return ((u1 - u0) * map.width) ** 2 + ((v1 - v0) * map.height) ** 2;
  };
  for (let py = 0; py < size; py++)
    for (let px = 0; px < size; px++) {
      const pixel = py * size + px,
        x = (2 * px + 1) * half - 1,
        y = (2 * py + 1) * half - 1;
      const surface = surfaceAt(x, y);
      for (let c = 0; c < CORNERS.length; c += 2)
        if (surfaceAt(x + CORNERS[c] * half, y + CORNERS[c + 1] * half) !== surface)
          truth.edge[pixel] = 1;
      let colour: ArrayLike<number> = surface === 2 ? behind : clear;
      if (surface === 1) {
        const across = span(x, y, half, 0),
          up = span(x, y, 0, half);
        // A footprint of one texel or less is magnified: one read, as the sampler's.
        const reads = Math.max(across, up) > 1 ? samples : 1,
          [ax, ay] = across >= up ? [2 * half, 0] : [0, 2 * half];
        sum.fill(0);
        for (let s = 0; s < reads; s++) {
          const t = (s + 0.5) / reads - 0.5;
          const [u, v] = mapAt(x + ax * t, y + ay * t);
          bilinear(map, linear, u, v, texel);
          for (let k = 0; k < 4; k++) sum[k] += texel[k] / reads;
        }
        if (sum[3] >= view.alphaTest) colour = sum;
        else colour = back?.(x, y, at) ? behind : clear;
      }
      for (let k = 0; k < 3; k++) truth.rgba[pixel * 4 + k] = linearToSrgb8(colour[k]);
      truth.rgba[pixel * 4 + 3] = 255;
    }
  return truth;
}

/** The gap of a bottom-left RGBA8 `image` to the truth: pixels farther than `levels` on a
 *  channel, silhouettes aside, and the largest gap there. */
export function truthGap(image: ArrayLike<number>, truth: Truth, levels = 1): TruthGap {
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
    if (most > levels) gap.pixels++;
  }
  return gap;
}

/** The proof of #443: the engine within `tolerance` pixels of the truth, and no farther from it
 *  than the witness. Undefined when it holds, else what fails. */
export function truthVerdict(engine: TruthGap, witness: TruthGap, tolerance: number) {
  const gap = `engine ${engine.pixels} px from the ground truth`;
  if (engine.pixels > tolerance) return `${gap}, tolerance ${tolerance} px`;
  if (engine.pixels > witness.pixels)
    return `${gap}, farther than the witness's ${witness.pixels} px`;
}
