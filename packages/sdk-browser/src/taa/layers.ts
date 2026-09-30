import { FILTER_FORMAT } from '../webgpu/blend/displayFilter.ts';

/** The display layers, the tint and the added value (`../webgpu/blend/displayFilter.ts`). */
export type DisplayLayers = readonly [GPUTextureView, GPUTextureView];

/** Their bindings in a `filtered` resolve, after the pass's own; per layer: value, now, history. */
export const LAYER_BINDINGS = { filterNow: 10, filterHistory: 11, addNow: 12, addHistory: 13 };
const LAYERS = [
  ['tint', 'filterNow', 'filterHistory'],
  ['add', 'addNow', 'addHistory'],
] as const;
type Part = (name: string, now: keyof typeof LAYER_BINDINGS, history: typeof now) => string;

/** What a `filtered` resolve adds, per layer, to the others: each is summed, boxed, clamped and
 *  mixed with its history as the as-is share is, its history read only when it holds the last
 *  image's (`params.w`). */
const PARTS = {
  bindings: (_, ...names) =>
    names
      .map((b) => `\n@group(0) @binding(${LAYER_BINDINGS[b]}) var ${b}:texture_2d<f32>;`)
      .join(''),
  vars: (n) => ` var ${n}=vec4f(0.0);var ${n}Lo=vec4f(1.0);var ${n}Hi=vec4f(0.0);\n`,
  tap: (n, now) =>
    `  let ${n}At=textureLoad(${now},at,0);${n}+=${n}At*weight;${n}Lo=min(${n}Lo,${n}At);${n}Hi=max(${n}Hi,${n}At);\n`,
  scaled: (n) => ` ${n}=clamp(${n}/max(total,1e-4),${n}Lo,${n}Hi);\n`,
  kept: (n, _, history) =>
    ` let ${n}Kept=select(${n},clamp(textureSampleLevel(${history},historySampler,previous.xy,0.0),${n}Lo,${n}Hi),view.params.w!=0.0);\n`,
  out: (n) => `,${n}`,
  mixed: (n) => `,(${n}*wc+${n}Kept*wh)/(wc+wh)`,
} satisfies Record<string, Part>;

/** The text of `part` for both layers in a `filtered` resolve; nothing in the others. */
export const layerWgsl = (filtered: boolean, part: keyof typeof PARTS) =>
  filtered ? LAYERS.map(([n, now, past]) => (PARTS[part] as Part)(n, now, past)).join('') : '';

/** The resolve's output: the current image alone, or `mixed` with the history kept; the share is 0
 *  in a resolve without it (`asIs` false), and written beside the pixel's placement `tag`
 *  (`historyWgsl.ts`) and, where the still image is drawn below the display, the weight its
 *  average holds, `count` (`stillWeightOut`). */
export const taaOut = (asIs: boolean, filtered: boolean, mixed = false, count?: string) => {
  const mix = (now: string, kept: string) => (mixed ? `(${now}*wc+${kept}*wh)/(wc+wh)` : now);
  const held = count ? stillWeightOut(count) : '0.0';
  return `TaaOut(${mix('filtered', 'kept')},vec4f(${asIs ? mix('share', 'keptShare') : '0.0'},tag,${held},0.0)${layerWgsl(filtered, mixed ? 'mixed' : 'out')})`;
};

/** The largest weight a still average records: two cycles of phases give about ten. */
export const STILL_WEIGHT_MAX = 16;
/** The weight `count` in eight bits, finer near zero where the first images weigh most; read
 *  back by `stillWeightIn`. */
export const stillWeightOut = (count: string) => `sqrt(saturate(${count}/${STILL_WEIGHT_MAX}.0))`;
export const stillWeightIn = (stored: string) => `${stored}*${stored}*${STILL_WEIGHT_MAX}.0`;

/** The layers' four textures in a `filtered` resolve's layout. */
export const layerEntries = (filtered: boolean): GPUBindGroupLayoutEntry[] =>
  (filtered ? Object.values(LAYER_BINDINGS) : []).map((binding) => ({
    binding,
    visibility: GPUShaderStage.FRAGMENT,
    texture: { sampleType: 'float' },
  }));

/**
 * The layers' two history pairs, in ping-pong with the colour's: made by the first image that
 * resolves them, dropped with the display filter (`../webgpu/pages/render/encodeDisplayFilter.ts`)
 * or the colour's targets, so a scene without a filtering blend keeps no byte of them. An image
 * that resolves none keeps them for the next.
 */
export function createTaaFilterHistory(device: GPUDevice) {
  const textures: GPUTexture[] = [],
    views: DisplayLayers[] = [];
  let saved = false,
    counted = 0;
  const history = {
    /** The target read next holds the last image's layers: what `params.w` tells the resolve. */
    written: false,
    get bytes() {
      return textures.reduce((sum, texture) => sum + texture.width * texture.height * 4, 0);
    },
    /** The bytes made since last asked: what the frame's target bytes add. */
    uncounted: () => -counted + (counted = history.bytes),
    /** Made, at the history's size, for the first image that resolves `filter`. */
    follow(filter: DisplayLayers | undefined, width: number, height: number) {
      const layer = (label: string) => {
        const texture = device.createTexture({
          label: `Trillion3D TAA display ${label}`,
          size: { width, height },
          format: FILTER_FORMAT,
          usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        });
        textures.push(texture);
        return texture.createView();
      };
      for (let i = views.length; filter && i < 2; i++)
        views.push([layer(`tint ${i}`), layer(`added value ${i}`)]);
    },
    /** The bindings of the group that reads history `rank`: none without layers. */
    entries: (filter: DisplayLayers | undefined, rank: number): GPUBindGroupEntry[] =>
      (filter ? LAYERS : []).flatMap(([, now, past], i) => [
        { binding: LAYER_BINDINGS[now], resource: filter![i] },
        { binding: LAYER_BINDINGS[past], resource: views[rank][i] },
      ]),
    /** The targets history `rank` is written through, when the image resolves layers. */
    target: (rank: number): DisplayLayers | undefined => views[rank],
    /** A convergence image replays the history the image it remakes read (`checkpoint`). */
    checkpoint: () => void (saved = history.written),
    replay: () => void (history.written = saved),
    drop() {
      for (const texture of textures) texture.destroy();
      textures.length = views.length = counted = 0;
      history.written = false;
    },
  };
  return history;
}
