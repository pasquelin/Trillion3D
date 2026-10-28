import { FILTER_FORMAT } from '../../blend/display/displayFilter.ts'
import { madeBytesOf, texelBytesOf } from '../../gpu/core/textureBytes.ts'
import { keptTexture } from './keptTexture.ts'
import { retire } from '../../gpu/core/frameRetire.ts'
import { computeStorageTextureEntry, computeTextureEntry } from '../../gpu/core/computeBindings.ts'

/** The display layers, the tint and the added value (`../../blend/display/displayFilter.ts`). */
export type DisplayLayers = readonly [GPUTextureView, GPUTextureView]
/** History pairs of the layers, in ping-pong with the colour's (`createTaaFilterHistory`). */
const HISTORY_PAIRS = 2
/** Bytes per pixel of the layers' history at the history's size: both layers of each pair, in
 *  `FILTER_FORMAT`. */
const FILTER_HISTORY_BYTES_PER_PIXEL = HISTORY_PAIRS * 2 * texelBytesOf(FILTER_FORMAT)

/** Bytes of the layers of a history of `shape`: both pairs at the history's size, and, where the
 *  history is larger than the display, the two layers the resolve writes at the display's. */
export const layerHistoryBytes = (shape: {
  width: number
  height: number
  displayWidth: number
  displayHeight: number
}) =>
  shape.width * shape.height * FILTER_HISTORY_BYTES_PER_PIXEL +
  (shape.width !== shape.displayWidth || shape.height !== shape.displayHeight
    ? shape.displayWidth * shape.displayHeight * 2 * texelBytesOf(FILTER_FORMAT)
    : 0)

/** Their bindings in a `filtered` update, after the pass's own; per layer: now, history. */
export const LAYER_BINDINGS = { filterNow: 10, filterHistory: 11, addNow: 12, addHistory: 13 }
/** The storage textures a `filtered` update writes the layers to, after the pass's own. */
const LAYER_OUTPUT_BINDINGS = { tint: 21, add: 22 }
const LAYERS = [
  ['tint', 'filterNow', 'filterHistory'],
  ['add', 'addNow', 'addHistory'],
] as const
type LayerName = keyof typeof LAYER_OUTPUT_BINDINGS
type Part = (
  name: LayerName,
  now: keyof typeof LAYER_BINDINGS,
  history: typeof now,
  V4: string,
) => string

/** What a `filtered` resolve adds, per layer, to the others: each is summed, boxed, clamped and
 *  mixed with its history by the colour's weights, its history read at the reprojected point
 *  (`prevUv`) only when it holds the last image's (`view.params.y`) and its box is not one value —
 *  a pixel no filtering surface covers sees `(1, 0)` all round, and a box of one value clamps any
 *  history to it. */
const PARTS = {
  bindings: (n, now, history) =>
    [now, history]
      .map((b) => `\n@group(0) @binding(${LAYER_BINDINGS[b]}) var ${b}:texture_2d<f32>;`)
      .join('') +
    `\n@group(0) @binding(${LAYER_OUTPUT_BINDINGS[n]}) var ${n}Out:texture_storage_2d<${FILTER_FORMAT},write>;`,
  vars: (n, _, __, V4) => ` var ${n}=${V4}(0.0);var ${n}Lo=${V4}(1.0);var ${n}Hi=${V4}(0.0);\n`,
  tap: (n, now, _, V4) =>
    `  let ${n}At=${V4}(textureLoad(${now},at,0));${n}+=${n}At*weight;${n}Lo=min(${n}Lo,${n}At);${n}Hi=max(${n}Hi,${n}At);\n`,
  scaled: (n) => ` ${n}=clamp(${n}/max(total,1e-4),${n}Lo,${n}Hi);\n`,
  kept: (n, _, history, V4) =>
    ` var ${n}Kept=${n};if(view.params.y!=0.0){${n}Kept=${n}Lo;if(any(${n}Lo!=${n}Hi)){${n}Kept=clamp(${V4}(textureSampleLevel(${history},historySampler,prevUv,0.0)),${n}Lo,${n}Hi);}}\n`,
  stored: (n) => `  textureStore(${n}Out,hp,vec4f(${weighed(n, `${n}Kept`)}));\n`,
} satisfies Record<string, Part>

/** The current value `now` and the history's `kept` by the blend's weights — the image's `wcScaled`,
 *  the history's `whScaled`, each a weight times its tone weight times the one reciprocal of their
 *  sum (`1/(wc+wh)`, computed in 32 bits), in the update's precision — shared by every output. */
const weighed = (now: string, kept: string) => `(${now}*wcScaled+${kept}*whScaled)`

/** The text of `part` for both layers in a `filtered` resolve, its values of `V4` (the update's
 *  precision, `vec4f` by default); nothing in the others. */
export const layerText = (filtered: boolean, part: keyof typeof PARTS, V4 = 'vec4f') =>
  filtered ? LAYERS.map(([n, now, past]) => (PARTS[part] as Part)(n, now, past, V4)).join('') : ''

/** The history update's stores for the history pixel `hp`: the colour, the history's validity in
 *  eight bits (`validity`, its metadata alone), then the display layers, each the current value
 *  mixed with its history's by the colour's weights. The caller holds them to the pixels the history
 *  holds (`inside`). */
export const taaStores = (filtered: boolean) =>
  `  textureStore(historyOut,hp,vec4f(color));
  textureStore(validityOut,hp,vec4f(f32(validity),0.0,0.0,0.0));
${layerText(filtered, 'stored')}`

/** The layers' four textures and the two they are written to in a `filtered` update's layout, seen
 *  by the compute stage. */
export const layerEntries = (filtered: boolean): GPUBindGroupLayoutEntry[] =>
  filtered
    ? [
        ...Object.values(LAYER_BINDINGS).map((binding) => computeTextureEntry(binding, 'float')),
        ...Object.values(LAYER_OUTPUT_BINDINGS).map((binding) =>
          computeStorageTextureEntry(binding, FILTER_FORMAT),
        ),
      ]
    : []

/**
 * The layers' two history pairs, in ping-pong with the colour's: made by the first image that
 * resolves them, dropped with the display filter (`../../frame/render/encodeDisplayFilter.ts`)
 * or the colour's targets, so a scene without a filtering blend keeps no byte of them. An image
 * that resolves none keeps them for the next. `usage` is theirs (`loadOnlyUsage`).
 */
export function createTaaFilterHistory(device: GPUDevice, usage: GPUTextureUsageFlags) {
  const textures: GPUTexture[] = [],
    views: DisplayLayers[] = []
  let counted = 0
  const history = {
    /** The target read next holds the last image's layers: what `params.y` tells the resolve. */
    written: false,
    get bytes() {
      return madeBytesOf(textures)
    },
    /** The bytes made since last asked: what the frame's target bytes add. */
    uncounted: () => -counted + (counted = history.bytes),
    /** Made, at the history's size, for the first image that resolves `filter`. */
    follow(filter: DisplayLayers | undefined, width: number, height: number) {
      const layer = (label: string) =>
        keptTexture(device, textures, {
          label: `Trillion3D TAA display ${label}`,
          size: { width, height },
          format: FILTER_FORMAT,
          usage,
        }).createView()
      for (let i = views.length; filter && i < HISTORY_PAIRS; i++)
        views.push([layer(`tint ${i}`), layer(`added value ${i}`)])
    },
    /** The bindings of the group that reads history `rank` and writes the other: none without
     *  layers. */
    entries: (filter: DisplayLayers | undefined, rank: number): GPUBindGroupEntry[] =>
      (filter ? LAYERS : []).flatMap(([name, now, past], i) => [
        { binding: LAYER_BINDINGS[now], resource: filter![i] },
        { binding: LAYER_BINDINGS[past], resource: views[rank][i] },
        { binding: LAYER_OUTPUT_BINDINGS[name], resource: views[1 - rank][i] },
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
