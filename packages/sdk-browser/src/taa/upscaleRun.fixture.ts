// The upscaling resolve (`upscaleWgsl.ts`), or the native one (`shaderWgsl.ts`), run in JavaScript
// over a small frame: its render inputs as functions of the texel, its history as one of the point
// read.
import { Mat, type Vec } from '../texture/shaderRun.fixture.ts';
import { taaUpscaleShader } from './upscaleWgsl.ts';
import { taaShader } from './shaderWgsl.ts';
import { TAA_WEIGHTS, taaWeights } from './filterWeights.ts';
import { IDENTITY_MATRIX4 } from '../../../sdk-core/src/index.ts';
import {
  moireStored,
  stillViewFields,
  taaBuiltins,
  textureGatherOf,
} from './taaBuiltins.fixture.ts';
import { pixelResolves } from './pixelRun.fixture.ts';

const IDENTITY = new Mat([...IDENTITY_MATRIX4]);

/** One frame drawn at `render` for a display of `display`; texel inputs default to the empty. */
export interface UpscaleFrame {
  render: [number, number];
  display: [number, number];
  /** This frame's jitter, in render pixels (`upscaleJitter`). */
  jitter?: [number, number];
  color: (x: number, y: number) => number[];
  /** Reversed depth: the nearest surface is the greatest. */
  depth?: (x: number, y: number) => number;
  id?: (x: number, y: number) => number;
  /** The history read at a point; absent, the frame has none. */
  history?: (uv: number[]) => number[];
  /** Placement 0's motion, once a placement moved. */
  motion?: Mat;
  prevViewProj?: Mat;
  /** The as-is flag (a blended resolve's float) and the display layers, per texel. */
  flag?: (x: number, y: number) => number;
  layer?: (x: number, y: number) => number[];
  /** The display layers' history read at a point, when it holds the last image's; absent, the
   *  layers' history is not written (`params.w` 0). */
  layerHistory?: (uv: number[]) => number[];
  /** The image moves (`view.jitter.z`): the history is read and blended as in motion. */
  moving?: boolean;
  /** The current image's share (`view.params.x`): 0.25 when absent. */
  share?: number;
  /** The reactive value the blends and particles wrote, per texel. */
  reactive?: (x: number, y: number) => number;
  /** The flags word of the one page every identifier names (`FLAG_DYNAMIC`, #573). */
  pageFlags?: number;
  placement?: number;
  historyGeometry?: (x: number, y: number) => [number, number];
  /** The share target at a point or texel (`historyWgsl.ts`): as-is share, flicker gradient, still
   *  weight, history count; its first channel, times 255, also the geometry history's identity.
   *  Absent, a share of 0 and a full count, the identity the pixel's own. */
  tags?: (uv: number[]) => number[];
  /** The flicker measure stored at a history texel (`moireStored`); absent, a history that holds
   *  the pixel's own blurred luma and no flicker. */
  moire?: (x: number, y: number) => number[];
}

/** What the resolve wrote at a display pixel, and where it read the history. */
interface Resolved {
  color: number[];
  share: number;
  /** The flicker gradient and the history count (out of 16) written beside the share. */
  gradient: number;
  count: number;
  /** The flicker measure written (`shadingPack`). */
  moire: number;
  /** The geometry identity written (`pageOf`): the placement plus one, 0 the background. */
  tag: number;
  /** The weight a still average holds, as stored (`stillWeightOut`). */
  held: number;
  layers: number[][];
  reads: number[][];
  /** Texels and filtered samples read, gathers included: the pixel's fetches. */
  fetches: number;
}

/** The resolve of `frame`, per display pixel; `asIs`, `blended` and `filtered` pick the variant,
 *  `native` the resolve at the render size, which weighs its 3×3 by the jitter's table
 *  (`weights.ts`). */
export function upscaleRun(
  frame: UpscaleFrame,
  asIs = false,
  filtered = false,
  native = false,
  { blended = asIs } = {},
) {
  const [w, h] = frame.render,
    [W, H] = frame.display,
    reads: number[][] = [];
  const texel =
    <T>(read: (x: number, y: number) => T) =>
    (at: Vec) => {
      const [x, y] = at as number[];
      // Every read lies in the render grid: the shader clamps its taps.
      if (x < 0 || y < 0 || x >= w || y >= h) throw new Error(`texel ${x},${y} outside`);
      return read(x, y);
    };
  const history = (uv: number[]) => (reads.push(uv), frame.history!(uv));
  const jitter = frame.jitter ?? [0, 0],
    weights = taaWeights(jitter[0], jitter[1], new Float32Array(TAA_WEIGHTS), 0);
  // Unwritten, the layers' history must not show: not a number, were it read.
  const layerHistory = frame.layerHistory ?? (() => [NaN, NaN, NaN, NaN]);
  const depth = texel(frame.depth ?? (() => 0));
  const geometryHistory = ([x, y]: number[]) => {
    const rx = Math.min(w - 1, Math.floor(((x + 0.5) * w) / W));
    const ry = Math.min(h - 1, Math.floor(((y + 0.5) * h) / H));
    const kept = () => frame.tags?.([(x + 0.5) / W, (y + 0.5) / H])[0];
    const own = (frame.id ? (frame.placement ?? 0) + 1 : 0) / 255;
    const given = frame.historyGeometry?.(x, y);
    const [tag, z] = given ?? [Math.round((kept() ?? own) * 255), frame.depth?.(rx, ry) ?? 0];
    return [tag, new Uint32Array(new Float32Array([z]).buffer)[0]];
  };
  // The depth target allocated past the image drawn in it (`drawFrameAt`): a gather reading
  // beyond the render grid meets `texel`'s guard.
  const textureDimensions = (texture: unknown) =>
    texture === geometryHistory ? [W, H] : texture === depth ? [w + 1, h + 1] : [w, h];
  const scope = {
    ...taaBuiltins,
    view: {
      prevViewProj: frame.prevViewProj ?? IDENTITY,
      invViewProj: IDENTITY,
      viewport: [W, H, 1 / W, 1 / H],
      params: [
        frame.share ?? 0.25,
        frame.history ? 1 : 0,
        frame.motion ? 1 : 0,
        frame.layerHistory ? 1 : 0,
      ],
      render: [w, h, 1 / w, 1 / h],
      jitter: [...jitter, frame.moving ? 1 : 0, 0],
      eye: [0, 0, 0, 0],
      tsr: [1, 0, 0, 0],
      weights: [0, 4, 8].map((at) => [...weights.subarray(at, at + 4)]),
      ...stillViewFields(W),
    },
    current: texel(frame.color),
    depth,
    ids: texel((x, y) => [frame.id?.(x, y) ?? 0, 0, 0, 0]),
    flags: texel((x, y) => [frame.flag?.(x, y) ?? 0, 0, 0, 0]),
    reactive: texel((x, y) => [0, frame.reactive?.(x, y) ?? 0, 0, 0]),
    textureDimensions,
    shadingHistory: ([x, y]: number[]) => frame.moire?.(x, y) ?? moireStored(owner.blurred),
    geometryHistory,
    shareHistory: (uv: number[]) => frame.tags?.(uv) ?? [0, 0, 0, 1],
    textureGather: textureGatherOf(textureDimensions),
    filterNow: texel(frame.layer ?? frame.color),
    addNow: texel(frame.layer ?? frame.color),
    pages: [{ placement: frame.placement ?? 0, deformOutput: 0, flags: frame.pageFlags ?? 0 }],
    motion: [frame.motion ?? IDENTITY],
    history,
    filterHistory: layerHistory,
    addHistory: layerHistory,
    historySampler: null,
    texelSampler: null,
    textureLoad: (texture: (at: Vec) => unknown, at: Vec) => texture(at),
    textureSampleLevel: (texture: (uv: number[]) => number[], _: null, uv: number[]) => texture(uv),
    TaaOut: (
      color: number[],
      [share, gradient, held, count]: number[],
      geometry: number[],
      moire: number,
      ...layers: number[][]
    ) => ({ color, share, gradient, count, tag: geometry[0], held, moire, layers }),
  };
  /** The blurred luma the pixel resolved is measuring: what a history of its own holds. */
  const owner = { blurred: 0 };
  // Without a reactive value, the resolve that reads none (`resolve.ts`, `unreactive`).
  const make = native ? taaShader : taaUpscaleShader;
  const shader = make(asIs, blended, filtered, !!frame.reactive);
  const resolve = pixelResolves(shader, scope, {
    before: (x, y) => void ((reads.length = 0), (owner.blurred = blurredAt(x, y))),
    after: (out) => ({ ...(out as Omit<Resolved, 'reads' | 'fetches'>), reads: reads.slice() }),
  });
  /** The blurred luma of display pixel `(x, y)`'s 3×3, in the measurement curve (`BLUR_TAP_WGSL`,
   *  `shadingLuma`, exposure one): its own history's, by default. */
  const blurredAt = (x: number, y: number) => {
    const base = native
      ? [x, y]
      : [((x + 0.5) * w) / W - 0.5, ((y + 0.5) * h) / H - 0.5].map((r) => Math.floor(r + 0.5));
    let blur = 0;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const at = [base[0] + dx, base[1] + dy].map((v, i) =>
          Math.min(Math.max(v, 0), [w, h][i] - 1),
        );
        const [r, g, b] = frame.color(at[0], at[1]);
        blur += (0.25 * r + 0.5 * g + 0.25 * b) * (2 - Math.abs(dx)) * (2 - Math.abs(dy));
      }
    const c = Math.max(blur / 16, 0),
      curve = c / (c + 0.17);
    return curve * curve;
  };
  return (x: number, y: number): Resolved => {
    const { value, fetches } = resolve(x, y);
    return { ...value, fetches };
  };
}
