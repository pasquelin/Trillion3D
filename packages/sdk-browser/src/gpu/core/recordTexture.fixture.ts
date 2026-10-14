// A record table's texels on the CPU (`recordTexture.ts`): where a record's field lies in a texture's
// words, laid as WebGPU lays a texture's — layer after layer, row after row, texel after texel —,
// what the kit's device keeps of a written table (`tests/kit/gpu`) and what a shader run in JavaScript
// loads (`textureLoad`, `../../texture/shaderRun.fixture.ts`).
import { fieldStart, recordExtent, texelAt, type RecordLayout } from './recordLayout.ts'
import { textureExtent } from './textureExtent.ts'
import { texelBytesOf } from './textureBytes.ts'

/** Words a texel of `layout` holds: its bytes (`texelBytesOf`) over a word's. */
const channels = (layout: RecordLayout) => texelBytesOf(layout.format) / 4

/** The extent `records` records of `layout` take: the engine's (`recordExtent`). */
export function recordExtentOf(layout: RecordLayout, records: number) {
  const [width, height, layers] = recordExtent(layout, records)
  return { width, height, layers }
}

/** The first word of texel `k` of field `field` of record `r`, in a texture of `height` rows a
 *  layer and `width` texels a row: the engine's texel (`texelAt`), a record's texels along its
 *  field's line after the record before. */
export function recordWordAt(
  layout: RecordLayout,
  { width, height }: { width: number; height: number },
  field: string,
  r: number,
  k = 0,
) {
  const [x, y, layer] = texelAt(layout, field, r * layout.fields[field] + k).origin
  return ((layer * height + y) * width + x) * channels(layout)
}

/** The texels a `queue.writeTexture` into field `field` of `layout` — its one field by default —
 *  sent: the first one's index along the field's line — a record's texels after the record
 *  before —, and their words. */
export function writtenTexels(
  layout: RecordLayout,
  write: {
    destination: GPUTexelCopyTextureInfo
    data: ArrayBufferView
    layout: GPUTexelCopyBufferLayout
    size: GPUExtent3D
  },
  field = Object.keys(layout.fields)[0],
) {
  const [x = 0, y = 0, layer = 0] = write.destination.origin as number[],
    [width, rows] = textureExtent(write.size),
    texel = channels(layout)
  const bytes = new Uint8Array(write.data.buffer, write.data.byteOffset, write.data.byteLength),
    words = new Uint32Array(width * rows * texel)
  for (let row = 0; row < rows; row++) {
    const from = (write.layout.offset ?? 0) + row * (write.layout.bytesPerRow ?? 0)
    words.set(
      new Uint32Array(bytes.slice(from, from + width * texel * 4).buffer),
      row * width * texel,
    )
  }
  const line = layout.fields[field] << layout.rowShift,
    row = (layer << layout.layerShift) + y
  return { first: row * line + x - fieldStart(layout, field), words }
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
