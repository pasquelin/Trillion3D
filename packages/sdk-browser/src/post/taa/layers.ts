import { FILTER_FORMAT } from '../../blend/display/displayFilter.ts'
import { texelBytesOf } from '../../gpu/core/textureBytes.ts'
import { retire } from '../../gpu/core/frameRetire.ts'
import { computeTextureEntry } from '../../gpu/core/computeBindings.ts'

/** The display layers, the tint and the added value (`../../blend/display/displayFilter.ts`). */
export type DisplayLayers = readonly [GPUTextureView, GPUTextureView]
/** History pairs of the layers, in ping-pong with the colour's (`createTaaFilterHistory`). */
const HISTORY_PAIRS = 2
/** Bytes per pixel of the layers' history at the display's size: both layers of each pair, in
 *  `FILTER_FORMAT`. */
export const FILTER_HISTORY_BYTES_PER_PIXEL = HISTORY_PAIRS * 2 * texelBytesOf(FILTER_FORMAT)

/** Their bindings in a `filtered` resolve, after the pass's own; per layer: value, now, history. */
export const LAYER_BINDINGS = { filterNow: 10, filterHistory: 11, addNow: 12, addHistory: 13 }
const LAYERS = [
  ['tint', 'filterNow', 'filterHistory'],
  ['add', 'addNow', 'addHistory'],
] as const
type Part = (name: string, now: keyof typeof LAYER_BINDINGS, history: typeof now) => string

/** What a `filtered` resolve adds, per layer, to the others: each is summed, boxed, clamped and
 *  mixed with its history as the as-is share is, its history read at the reprojected point
 *  (`prevUv`) only when it holds the last image's (`view.params.y`) and its box is not one value —
 *  a pixel no filtering surface covers sees `(1, 0)` all round, and a box of one value clamps any
 *  history to it. */
const PARTS = {
  bindings: (_, now, history) =>
    [now, history]
      .map((b) => `\n@group(0) @binding(${LAYER_BINDINGS[b]}) var ${b}:texture_2d<f32>;`)
      .join(''),
  vars: (n) => ` var ${n}=vec4f(0.0);var ${n}Lo=vec4f(1.0);var ${n}Hi=vec4f(0.0);\n`,
  tap: (n, now) =>
    `  let ${n}At=textureLoad(${now},at,0);${n}+=${n}At*weight;${n}Lo=min(${n}Lo,${n}At);${n}Hi=max(${n}Hi,${n}At);\n`,
  scaled: (n) => ` ${n}=clamp(${n}/max(total,1e-4),${n}Lo,${n}Hi);\n`,
  kept: (n, _, history) =>
    ` var ${n}Kept=${n};if(view.params.y!=0.0){${n}Kept=${n}Lo;if(any(${n}Lo!=${n}Hi)){${n}Kept=clamp(textureSampleLevel(${history},historySampler,prevUv,0.0),${n}Lo,${n}Hi);}}\n`,
  mixed: (n) => `,${weighed(n, `${n}Kept`)}`,
} satisfies Record<string, Part>

/** The current value `now` and the history's `kept` by the blend's weights — the image's `wc`, the
 *  history's `wh`, each a weight times its tone weight —, one reciprocal (`blendScale`,
 *  `1/(wc+wh)`) shared by every output. */
const weighed = (now: string, kept: string) => `(${now}*wc+${kept}*wh)*blendScale`

/** The text of `part` for both layers in a `filtered` resolve; nothing in the others. */
export const layerText = (filtered: boolean, part: keyof typeof PARTS) =>
  filtered ? LAYERS.map(([n, now, past]) => (PARTS[part] as Part)(n, now, past)).join('') : ''

/** The history update's output: the colour, the share target — the as-is share (0 in a resolve
 *  without it, `asIs` false) and the history's validity in eight bits (`validity`) — then the
 *  display layers, each the current value mixed with its history's by the colour's weights. */
export const taaOut = (asIs: boolean, filtered: boolean) =>
  `TaaOut(color,vec4f(${asIs ? weighed('share', 'keptShare') : '0.0'},validity,0.0,0.0)${layerText(filtered, 'mixed')})`

/** The layers' four textures in a `filtered` resolve's layout, read by the fragment stage. */
export const layerEntries = (filtered: boolean): GPUBindGroupLayoutEntry[] =>
  filtered
    ? Object.values(LAYER_BINDINGS).map((binding) =>
        computeTextureEntry(binding, 'float', '2d', GPUShaderStage.FRAGMENT),
      )
    : []

/**
 * The layers' two history pairs, in ping-pong with the colour's: made by the first image that
 * resolves them, dropped with the display filter (`../../frame/render/encodeDisplayFilter.ts`)
 * or the colour's targets, so a scene without a filtering blend keeps no byte of them. An image
 * that resolves none keeps them for the next. `usage` is theirs (`resolveTargetUsage`).
 */
export function createTaaFilterHistory(device: GPUDevice, usage: GPUTextureUsageFlags) {
  const textures: GPUTexture[] = [],
    views: DisplayLayers[] = []
  let counted = 0
  const history = {
    /** The target read next holds the last image's layers: what `params.y` tells the resolve. */
    written: false,
    get bytes() {
      return textures.reduce(
        (sum, texture) => sum + texture.width * texture.height * texelBytesOf(FILTER_FORMAT),
        0,
      )
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
          usage,
        })
        textures.push(texture)
        return texture.createView()
      }
      for (let i = views.length; filter && i < HISTORY_PAIRS; i++)
        views.push([layer(`tint ${i}`), layer(`added value ${i}`)])
    },
    /** The bindings of the group that reads history `rank`: none without layers. */
    entries: (filter: DisplayLayers | undefined, rank: number): GPUBindGroupEntry[] =>
      (filter ? LAYERS : []).flatMap(([, now, past], i) => [
        { binding: LAYER_BINDINGS[now], resource: filter![i] },
        { binding: LAYER_BINDINGS[past], resource: views[rank][i] },
      ]),
    /** The targets history `rank` is written through, when the image resolves layers. */
    target: (rank: number): DisplayLayers | undefined => views[rank],
    drop() {
      // This image's commands may still name them: retired, destroyed after the frame's submit.
      for (const texture of textures) retire(device, texture)
      textures.length = views.length = counted = 0
      history.written = false
    },
  }
  return history
}
