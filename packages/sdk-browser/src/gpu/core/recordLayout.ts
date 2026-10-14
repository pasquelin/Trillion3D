import { ceilDiv } from '../../../../math/src/scalar/integers.ts'

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

/** WebGPU's guaranteed side of a 2D texture and layers of an array. */
const SIDE = 8192,
  LAYERS = 256

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
  if (width > SIDE || perLayer > SIDE || layers > LAYERS)
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
  const width = layout.fields[field] << layout.rowShift,
    start = fieldStart(layout, field),
    rowMask = (1 << layout.layerShift) - 1
  for (let t = first, end = first + count; t < end;) {
    const row = Math.floor(t / width),
      column = t - row * width,
      y = row & rowMask,
      layer = row >> layout.layerShift
    let texels = width,
      rows = 1
    if (column || end - t < width) texels = Math.min(width - column, end - t)
    else rows = Math.min(Math.floor((end - t) / width), rowMask + 1 - y)
    visit(start + column, y, layer, texels, rows, t)
    t += rows === 1 ? texels : rows * width
  }
}

/** The records an extent of `layout` holds (`recordExtent`): its rows' whole. */
export const heldRecords = (layout: RecordLayout, [, rows, layers]: [number, number, number]) =>
  (layers === 1 ? rows : layers << layout.layerShift) << layout.rowShift

/** Where texel `t` of field `field` lies — its column, row and layer —, and the texels of its
 *  field's line left in that row from it. */
export function texelAt(layout: RecordLayout, field: string, t: number) {
  const width = layout.fields[field] << layout.rowShift,
    row = Math.floor(t / width),
    column = t - row * width
  return {
    origin: [
      fieldStart(layout, field) + column,
      row & ((1 << layout.layerShift) - 1),
      row >> layout.layerShift,
    ],
    left: width - column,
  }
}
