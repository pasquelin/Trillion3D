// The upscaling resolve (`upscaleWgsl.ts`), or the native one (`shaderWgsl.ts`), run in JavaScript
// over a small frame: its render inputs as functions of the texel, its history as one of the point
// read.
import { Mat, shaderRun, type Vec } from '../texture/shaderRun.fixture.ts';
import { taaUpscaleShader } from './upscaleWgsl.ts';
import { taaShader } from './shaderWgsl.ts';
import { TAA_WEIGHTS, taaWeights } from './filterWeights.ts';
import { IDENTITY_MATRIX4 } from '../../../sdk-core/src/index.ts';
export { blend, kernel, owed } from './upscaleOwed.fixture.ts';

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
  /** The placement tags of the four history texels read at a point (`historyWgsl.ts`); absent,
   *  those of the 3×3 are there. */
  tags?: (uv: number[]) => number[];
}

/** What the resolve wrote at a display pixel, and where it read the history. */
interface Resolved {
  color: number[];
  share: number;
  /** The placement tag written beside the share, 0 to 255. */
  tag: number;
  /** The weight a still average holds, as stored (`stillWeightOut`). */
  held: number;
  layers: number[][];
  reads: number[][];
  /** Texels and filtered samples read, gathers included: the pixel's fetches. */
  fetches: number;
}

/** The resolve of `frame`, per display pixel; `asIs` and `filtered` pick the variant, `native` the
 *  resolve at the render size, which weighs its 3×3 by the jitter's table (`weights.ts`). */
export function upscaleRun(frame: UpscaleFrame, asIs = false, filtered = false, native = false) {
  const [w, h] = frame.render,
    [W, H] = frame.display,
    reads: number[][] = [],
    count =
      (read: (...args: never[]) => unknown) =>
      (...args: never[]) => (fetches++, read(...args));
  let fetches = 0;
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
  // Unwritten, the layers' history is read all the same and must not show.
  const layerHistory = frame.layerHistory ?? (() => [NaN, NaN, NaN, NaN]);
  const scope = {
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
      weights: [0, 4, 8].map((at) => [...weights.subarray(at, at + 4)]),
    },
    current: texel(frame.color),
    depth: texel(frame.depth ?? (() => 0)),
    ids: texel((x, y) => [frame.id?.(x, y) ?? 0, 0, 0, 0]),
    flags: texel((x, y) => [frame.flag?.(x, y) ?? 0, 0, 0, 0]),
    reactive: texel((x, y) => [0, frame.reactive?.(x, y) ?? 0, 0, 0]),
    textureDimensions: () => [w, h],
    tagHistory: (uv: number[]) => frame.tags?.(uv) ?? [0, 1, 0, 1].map((tag) => tag / 255),
    textureGather: count((_: number, texture: (uv: number[]) => number[], __: null, uv: number[]) =>
      texture(uv),
    ),
    filterNow: texel(frame.layer ?? frame.color),
    addNow: texel(frame.layer ?? frame.color),
    pages: [{ placement: 0, deformOutput: 0, flags: frame.pageFlags ?? 0 }],
    motion: [frame.motion ?? IDENTITY],
    history,
    shareHistory: history,
    filterHistory: layerHistory,
    addHistory: layerHistory,
    historySampler: null,
    textureLoad: count((texture: (at: Vec) => unknown, at: Vec) => texture(at)),
    textureSampleLevel: count((texture: (uv: number[]) => number[], _: null, uv: number[]) =>
      texture(uv),
    ),
    TaaOut: (color: number[], [share, tag, held]: number[], ...layers: number[][]) => ({
      color,
      share,
      tag: Math.round(tag * 255),
      held,
      layers,
    }),
  };
  const { resolve } = shaderRun<{ resolve: (pixel: number[]) => Omit<Resolved, 'reads'> }>(
    (native ? taaShader : taaUpscaleShader)(asIs, asIs, filtered),
    [
      'resolve',
      ...(native ? [] : ['lanczos2', 'blackmanHarris']),
      'previousUv',
      'toYcocg',
      'fromYcocg',
      'historyCatmullRom',
      'placementOf',
      'tagOf',
      'placementTag',
      'dynamicPixel',
      'uncovered',
      'currentShare',
    ],
    scope,
  );
  return (x: number, y: number): Resolved => {
    reads.length = fetches = 0;
    return { ...resolve([x + 0.5, y + 0.5, 0, 1]), reads: reads.slice(), fetches };
  };
}
