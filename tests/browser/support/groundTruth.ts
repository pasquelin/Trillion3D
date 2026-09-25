// The supersampled ground truth of a grazing material fixture (#443): the view the renderers draw,
// cast on the CPU through `SAMPLES`² rays per pixel into the fixture's square and the square
// behind it. Each ray reads the map's base level as its magnification filter does — bilinear,
// repeated —, cut at the alpha cutoff; the rays of a pixel are averaged in linear light. No mip
// level and no footprint: what a perfect sampler converges to, the reference both engines are
// judged against, the witness no longer being the truth.
//
// A renderer's gap to it is counted as the measurer counts one (#443): pixels farther than one
// 8-bit level on a channel. A pixel a silhouette crosses is not counted — the renderers draw it
// with one sample, the truth with its coverage: that is antialiasing, not texture sampling.
//
// Pure: served to the harness page (`materialTruth.ts`) and run in Node by its unit test.
import { Matrix4 } from '../../../packages/sdk-core/src/world/math/matrix4.ts';
import { Vector3 } from '../../../packages/sdk-core/src/world/math/vector3.ts';
import { Color } from '../../../packages/sdk-core/src/world/math/color.ts';
import {
  linearToSrgb8,
  srgbToLinear,
} from '../../../packages/sdk-core/src/math/primitives/color.ts';
import { wrapLinear } from '../../../packages/sdk-browser/src/visibility/wrapModes.ts';

/** Rays per pixel side: 256 rays a pixel, a step of 1/16 pixel. */
const SAMPLES = 16;

/** A map as the square wears it: RGBA8 texels, row 0 at v = 0, addressed by repeat. */
export interface TruthMap {
  data: ArrayLike<number>;
  width: number;
  height: number;
  /** Whether its colours are sRGB-encoded, decoded before they are mixed. */
  srgb: boolean;
  /** Its UV transform, a 3×3 matrix column-major (`GraphTexture.matrix`). */
  uv: ArrayLike<number>;
}

/** One fixture's view: a white unlit 2×2 square wearing `map`, placed by `square`, over the 4×4
 *  square of colour `behind` at z = -1 when it declares one, over `clear` elsewhere. */
export interface TruthView {
  size: number;
  camera: { matrixWorld: Matrix4; projectionMatrixInverse: Matrix4 };
  square: Matrix4;
  map: TruthMap;
  /** Alpha under which a ray passes through the square; 0 keeps every ray. */
  alphaTest: number;
  behind?: number;
  clear: number;
}

/** The truth, a bottom-left RGBA8 image, and the pixels a silhouette crosses (1). */
export interface Truth {
  rgba: Uint8Array;
  edge: Uint8Array;
}

/** A renderer's gap to the truth: pixels farther than the level allowed, and the largest gap. */
export interface TruthGap {
  pixels: number;
  max: number;
}

const linearOf = (hex: number) => new Color(hex).toArray();

/** Adds `weight` times the linear RGBA of texel `(x, y)` into `out`. */
function tap(
  map: TruthMap,
  linear: Float32Array,
  x: number,
  y: number,
  weight: number,
  out: Float64Array,
) {
  const i = (y * map.width + x) * 4;
  for (let k = 0; k < 4; k++) out[k] += weight * linear[i + k];
}

/** Linear RGB then alpha of the map at `(u, v)`, bilinear and repeated as the CPU mirror of the
 *  samplers reads it (`wrapLinear`), into `out`. */
function bilinear(map: TruthMap, linear: Float32Array, u: number, v: number, out: Float64Array) {
  const [x0, x1, wx] = wrapLinear(u, map.width, 'repeat'),
    [y0, y1, wy] = wrapLinear(v, map.height, 'repeat');
  out.fill(0);
  tap(map, linear, x0, y0, (1 - wx) * (1 - wy), out);
  tap(map, linear, x1, y0, wx * (1 - wy), out);
  tap(map, linear, x0, y1, (1 - wx) * wy, out);
  tap(map, linear, x1, y1, wx * wy, out);
}

/** Where a ray between two points of the near and far planes meets, from its front (+z) side, the
 *  square of half-side `half` in the plane z = `z`: the fraction of the way, the point written in
 *  `at`; Infinity when it misses. */
function hit(near: Vector3, far: Vector3, z: number, half: number, at: Vector3) {
  const t = (z - near.z) / (far.z - near.z);
  if (far.z >= near.z || t < 0 || t > 1) return Infinity;
  at.lerpVectors(near, far, t);
  return Math.abs(at.x) > half || Math.abs(at.y) > half ? Infinity : t;
}

/** Renders `view` with `samples`² rays a pixel. */
export function groundTruth(view: TruthView, samples = SAMPLES): Truth {
  const { size, map, camera } = view;
  const linear = Float32Array.from(map.data, (value, i) =>
    map.srgb && i % 4 !== 3 ? srgbToLinear(value / 255) : value / 255,
  );
  const toWorld = new Matrix4().multiplyMatrices(
    camera.matrixWorld,
    camera.projectionMatrixInverse,
  );
  const toSquare = view.square.clone().invert().multiply(toWorld);
  const [near, far, at] = [0, 0, 0].map(() => new Vector3());
  const texel = new Float64Array(4),
    sum = new Float64Array(3);
  const [behind, clear] = [view.behind ?? 0, view.clear].map(linearOf);
  const e = map.uv;
  const truth: Truth = { rgba: new Uint8Array(size * size * 4), edge: new Uint8Array(size * size) };
  /** The surface a ray meets first, geometry alone (0 none, 1 the square, 2 the one behind),
   *  and its linear colour added into `sum`. The square behind is read first, in world space. */
  const cast = (x: number, y: number) => {
    let back = Infinity;
    if (view.behind !== undefined) {
      near.set(x, y, -1).applyMatrix4(toWorld);
      far.set(x, y, 1).applyMatrix4(toWorld);
      back = hit(near, far, -1, 2, at);
    }
    near.set(x, y, -1).applyMatrix4(toSquare);
    far.set(x, y, 1).applyMatrix4(toSquare);
    const square = hit(near, far, 0, 1, at);
    const surface = square < back ? 1 : back < Infinity ? 2 : 0;
    if (surface === 1) {
      const u = (at.x + 1) / 2,
        v = (at.y + 1) / 2;
      bilinear(map, linear, e[0] * u + e[3] * v + e[6], e[1] * u + e[4] * v + e[7], texel);
      if (texel[3] >= view.alphaTest) {
        for (let k = 0; k < 3; k++) sum[k] += texel[k];
        return surface;
      }
    }
    const colour = back < Infinity ? behind : clear;
    for (let k = 0; k < 3; k++) sum[k] += colour[k];
    return surface;
  };
  for (let py = 0; py < size; py++)
    for (let px = 0; px < size; px++) {
      sum.fill(0);
      const pixel = py * size + px;
      let first = -1;
      for (let sy = 0; sy < samples; sy++)
        for (let sx = 0; sx < samples; sx++) {
          const x = ((px + (sx + 0.5) / samples) / size) * 2 - 1,
            y = ((py + (sy + 0.5) / samples) / size) * 2 - 1;
          const surface = cast(x, y);
          if (first < 0) first = surface;
          else if (surface !== first) truth.edge[pixel] = 1;
        }
      for (let k = 0; k < 3; k++) truth.rgba[pixel * 4 + k] = linearToSrgb8(sum[k] / samples ** 2);
      truth.rgba[pixel * 4 + 3] = 255;
    }
  return truth;
}

/** The gap of a bottom-left RGBA8 `image` to the truth: pixels farther than `levels` on a
 *  channel, silhouettes aside, and the largest gap there. */
export function truthGap(image: ArrayLike<number>, truth: Truth, levels = 1): TruthGap {
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
