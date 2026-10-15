import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { GUARANTEED_SIDE, PORTABLE_TEXTURE_LAYERS } from './textureLimits.ts'

/**
 * THE RECORD TEXTURES: the engine's one home for a table of records that grows with the world — the
 * culling's worlds, and every table a pass reads by placement — in a `uint` texture read with
 * `textureLoad`, whatever its size. A storage binding holds 128 MiB on a guaranteed device and a
 * stage binds eight of them; a sampled texture binds through one of the sixteen sampled slots a stage
 * holds, and addresses 8192 × 8192 × 256 texels: 2³⁴, 256 GiB of `rgba32uint`. The material records
 * (`../../webgpu/material/materialTable.ts`) are the first table laid so; this module lays any.
 *
 * A record is a few fields of whole texels. A row holds `1 << rowShift` records: each field's texels
 * of all of them, field after field — so a run of records writes each field from its own host array,
 * the bytes it held, in one rectangle of texels (`texelPieces`) —, and a layer `1 << layerShift`
 * rows. Every count is a power of two: a record's row, layer and column are shifts and masks.
 */
export type RecordLayout = {
  label: string
  format: 'rgba32uint' | 'r32uint'
  /** Texels of each field of a record, by name, in their order along a row. */
  fields: Readonly<Record<string, number>>
  rowShift: number
  layerShift: number
}

/** The first texel of field `field` in a row of `layout`; past the last field, the row's texels. */
export function fieldStart(layout: RecordLayout, field?: string) {
  let start = 0
  for (const [name, texels] of Object.entries(layout.fields)) {
    if (name === field) return start
    start += texels << layout.rowShift
  }
  return start
}
const rowTexels = (layout: RecordLayout) => fieldStart(layout)

/** The texture extent of `records` records of `layout`: one layer as tall as its rows, or whole
 *  layers. Refused by name past what a guaranteed device addresses. */
export function recordExtent(layout: RecordLayout, records: number): [number, number, number] {
  const width = rowTexels(layout),
    rows = Math.max(1, ceilDiv(records, 1 << layout.rowShift)),
    perLayer = 1 << layout.layerShift
  const layers = ceilDiv(rows, perLayer)
  if (width > GUARANTEED_SIDE || perLayer > GUARANTEED_SIDE || layers > PORTABLE_TEXTURE_LAYERS)
    throw new Error(`GPU_RECORD_TABLE_PAST_TEXTURE: ${layout.label}, ${records} records`)
  return layers === 1 ? [width, rows, 1] : [width, perLayer, layers]
}

/** Where a rectangle of texels a write sends lands — its origin, its extent — and the first texel
 *  of the field it carries. */
export type PieceVisit = (
  x: number,
  y: number,
  layer: number,
  width: number,
  rows: number,
  first: number,
) => void

/**
 * The rectangles a write of texels `[first, first + count)` of field `field` lands in, each given to
 * `visit` in order — nothing is allocated. A field is one line of texels — record `r`'s texel `k` is
 * its texel `r · texels + k` —, folded into rows of `texels << rowShift`: a row's tail, then whole
 * rows of one layer, then a row's head — never a texel of another field. A run of whole records is a
 * run of their texels.
 */
export function texelPieces(
  layout: RecordLayout,
  field: string,
  first: number,
  count: number,
  visit: PieceVisit,
) {
  const width = layout.fields[field] << layout.rowShift
  for (let t = first, end = first + count; t < end;) {
    const { x, y, layer, column } = placeTexel(layout, field, t)
    let texels = Math.min(width - column, end - t),
      rows = 1
    // A run of whole rows from a row's start goes as one piece, within a layer.
    if (!column && end - t >= width) {
      texels = width
      rows = Math.min(Math.floor((end - t) / width), (1 << layout.layerShift) - y)
    }
    visit(x, y, layer, texels, rows, t)
    t += rows === 1 ? texels : rows * width
  }
}

/** Where `placeTexel` writes: one place, reused, no object a texel. */
const placed = { x: 0, y: 0, layer: 0, column: 0 }

/** Texel `t` of field `field`: its column in its field's line, and where it lies — the texture's
 *  column, row and layer. The one address of a texel the host writes (`texelPieces`, `texelAt`). */
function placeTexel(layout: RecordLayout, field: string, t: number) {
  const width = layout.fields[field] << layout.rowShift,
    row = Math.floor(t / width)
  placed.column = t - row * width
  placed.x = fieldStart(layout, field) + placed.column
  placed.y = row & ((1 << layout.layerShift) - 1)
  placed.layer = row >> layout.layerShift
  return placed
}

/** The records an extent of `layout` holds (`recordExtent`): its rows' whole. */
export const heldRecords = (layout: RecordLayout, [, rows, layers]: [number, number, number]) =>
  (layers === 1 ? rows : layers << layout.layerShift) << layout.rowShift

/** Where texel `t` of field `field` lies — its column, row and layer —, and the texels of its
 *  field's line left in that row from it. */
export function texelAt(layout: RecordLayout, field: string, t: number) {
  const { x, y, layer, column } = placeTexel(layout, field, t)
  return { origin: [x, y, layer], left: (layout.fields[field] << layout.rowShift) - column }
}
