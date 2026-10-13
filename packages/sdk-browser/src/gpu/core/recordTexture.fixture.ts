// A record table's texels on the CPU (`recordTexture.ts`): where a record's field lies in a texture's
// words, laid as WebGPU lays a texture's — layer after layer, row after row, texel after texel —,
// what the kit's device keeps of a written table (`tests/kit/gpu`) and what a shader run in JavaScript
// loads (`textureLoad`, `../../texture/shaderRun.fixture.ts`).
import { fieldStart, type RecordLayout } from './recordTexture.ts'

/** Words a texel of `layout` holds. */
const channels = (layout: RecordLayout) => (layout.format === 'rgba32uint' ? 4 : 1)

/** The extent `records` records of `layout` take, as the engine makes it. */
export function recordExtentOf(layout: RecordLayout, records: number) {
  const width = fieldStart(layout),
    per = 1 << layout.rowShift,
    perLayer = 1 << layout.layerShift,
    rows = Math.max(1, Math.ceil(records / per))
  return { width, height: Math.min(rows, perLayer), layers: Math.ceil(rows / perLayer) }
}

/** The first word of texel `k` of field `field` of record `r`, in a texture of `height` rows a
 *  layer and `width` texels a row. */
export function recordWordAt(
  layout: RecordLayout,
  { width, height }: { width: number; height: number },
  field: string,
  r: number,
  k = 0,
) {
  const row = r >> layout.rowShift,
    y = row & ((1 << layout.layerShift) - 1),
    layer = row >> layout.layerShift,
    x = fieldStart(layout, field) + (r & ((1 << layout.rowShift) - 1)) * layout.fields[field] + k
  return ((layer * height + y) * width + x) * channels(layout)
}

/** A texture's words as `textureLoad` answers them — four words, an `r32uint`'s word in the first —
 *  at `(x, y)` of `layer`, and as `textureStore` writes them: a table held in words, or the words a
 *  fake device keeps of a texture (`tests/kit/gpu`). */
export function texelWords(
  format: RecordLayout['format'],
  { width, height }: { width: number; height: number },
  held: Uint32Array,
) {
  const words = format === 'rgba32uint' ? 4 : 1,
    at = ([x, y]: number[], layer: number) => ((layer * height + y) * width + x) * words
  return {
    load(coords: number[], layer: number) {
      const i = at(coords, layer)
      return words === 4 ? [...held.subarray(i, i + 4)] : [held[i], 0, 0, 1]
    },
    store(coords: number[], layer: number, value: number[]) {
      held.set(value.slice(0, words), at(coords, layer))
    },
  }
}

/**
 * A record table held in words: `set` a record's field, `get` it back, `load` and `store` a texel
 * (`texelWords`).
 */
export function recordTable(layout: RecordLayout, records: number, words?: Uint32Array) {
  const extent = recordExtentOf(layout, records),
    size = extent.width * extent.height * extent.layers * channels(layout)
  const held = words ?? new Uint32Array(size)
  return {
    words: held,
    set(field: string, r: number, values: ArrayLike<number>) {
      held.set(values, recordWordAt(layout, extent, field, r))
    },
    get(field: string, r: number) {
      const at = recordWordAt(layout, extent, field, r)
      return held.slice(at, at + layout.fields[field] * channels(layout))
    },
    ...texelWords(layout.format, extent, held),
  }
}
