import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { arrayView } from './textureViews.ts'
import { retire } from './frameRetire.ts'

/**
 * THE RECORD TEXTURES: the engine's one home for a table of records that grows with the world — the
 * culling's worlds, and every table a pass reads by placement — in a `uint` texture read with
 * `textureLoad`, whatever its size. A storage binding holds 128 MiB on a guaranteed device and a
 * stage binds eight of them; a sampled texture binds through one of the sixteen sampled slots a stage
 * holds, and addresses 8192 × 8192 × 256 texels: 2³⁴, 256 GiB of `rgba32uint`. The physical records
 * (`../../webgpu/visibility/physicalTable.ts`) are the first table laid so; this module lays any.
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

/** Bytes of one texel of `format`. */
const texelBytes = (format: RecordLayout['format']) => (format === 'rgba32uint' ? 16 : 4)

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
function recordExtent(layout: RecordLayout, records: number): [number, number, number] {
  const width = rowTexels(layout),
    rows = Math.max(1, ceilDiv(records, 1 << layout.rowShift)),
    perLayer = 1 << layout.layerShift
  const layers = ceilDiv(rows, perLayer)
  if (width > SIDE || perLayer > SIDE || layers > LAYERS)
    throw new Error(`GPU_RECORD_TABLE_PAST_TEXTURE: ${layout.label}, ${records} records`)
  return layers === 1 ? [width, rows, 1] : [width, perLayer, layers]
}

/** One rectangle of texels a write sends: its origin, its extent, and the first texel of the field
 *  it carries. */
type Piece = { x: number; y: number; layer: number; width: number; rows: number; first: number }

/**
 * The rectangles a write of texels `[first, first + count)` of field `field` lands in. A field is one
 * line of texels — record `r`'s texel `k` is its texel `r · texels + k` —, folded into rows of
 * `texels << rowShift`: a row's tail, then whole rows of one layer, then a row's head — never a texel
 * of another field. A run of whole records is a run of their texels.
 */
function texelPieces(layout: RecordLayout, field: string, first: number, count: number): Piece[] {
  const width = layout.fields[field] << layout.rowShift,
    start = fieldStart(layout, field),
    rowMask = (1 << layout.layerShift) - 1
  const pieces: Piece[] = []
  for (let t = first, end = first + count; t < end;) {
    const row = Math.floor(t / width),
      column = t - row * width,
      y = row & rowMask,
      layer = row >> layout.layerShift
    let texels = width,
      rows = 1
    if (column || end - t < width) texels = Math.min(width - column, end - t)
    else rows = Math.min(Math.floor((end - t) / width), rowMask + 1 - y)
    pieces.push({ x: start + column, y, layer, width: texels, rows, first: t })
    t += rows === 1 ? texels : rows * width
  }
  return pieces
}

/** The records an extent of `layout` holds (`recordExtent`): its rows' whole. */
const heldRecords = (layout: RecordLayout, [, rows, layers]: [number, number, number]) =>
  (layers === 1 ? rows : layers << layout.layerShift) << layout.rowShift

/**
 * A record table made on `device` for `records` records: its texture and the view every pass binds
 * (`2d-array`, whatever its layers), and the writes of the host — a run of records' field from the
 * bytes that hold it, or through a byte target (`target`), what the cut's run writer sends
 * (`../dag/split.ts`, `writeRanges`). `usage` is the texture's, the caller's: a GPU writer adds
 * `STORAGE_BINDING`, a table that grows (`hold`) `COPY_SRC`. `make` creates it, `bytes` large: an
 * owner's admission and ledger (`../dag/resources.ts`).
 *
 * A table grows in place of a second one beside it (`hold`): made larger, the records it held
 * copied on the GPU once, in the queue's order behind every write sent to it, the one replaced
 * retired after the frame that may name it (`retire`). Its texture and view are then new: every
 * group that binds it follows the view's identity (`createWebgpuBindIdentity`).
 */
export function createRecordTexture(
  device: GPUDevice,
  layout: RecordLayout,
  records: number,
  usage: GPUTextureUsageFlags,
  make: (descriptor: GPUTextureDescriptor, bytes: number) => GPUTexture = (descriptor) =>
    device.createTexture(descriptor),
) {
  const bytes = texelBytes(layout.format)
  /** The texture of `count` records, made by `make`. */
  const made = (count: number) => {
    const size = recordExtent(layout, count),
      held = size[0] * size[1] * size[2] * bytes
    const texture = make({ label: layout.label, size, format: layout.format, usage }, held)
    return { texture, size, held, view: arrayView(texture), capacity: heldRecords(layout, size) }
  }
  let table = made(records)
  /** Texels `[first, first + count)` of field `field` (`texelPieces`), `data` holding them from
   *  `dataOffset` bytes, one after the other. */
  const writeTexels = (
    field: string,
    first: number,
    count: number,
    data: ArrayBuffer,
    dataOffset: number,
  ) => {
    const rowBytes = (layout.fields[field] << layout.rowShift) * bytes
    for (const piece of texelPieces(layout, field, first, count))
      device.queue.writeTexture(
        { texture: table.texture, origin: [piece.x, piece.y, piece.layer] },
        data,
        { offset: dataOffset + (piece.first - first) * bytes, bytesPerRow: rowBytes },
        [piece.width, piece.rows, 1],
      )
  }
  /** Field `field` of the `count` records from `first`, `data` holding them from `dataOffset`
   *  bytes, each record's field after the other. */
  const write = (
    field: string,
    first: number,
    count: number,
    data: ArrayBuffer,
    dataOffset: number,
  ) => {
    const texels = layout.fields[field]
    writeTexels(field, first * texels, count * texels, data, dataOffset)
  }
  return {
    get texture() {
      return table.texture
    },
    get view() {
      return table.view
    },
    /** Bytes the texture holds. */
    get bytes() {
      return table.held
    },
    /** The records it holds: at least as many as asked, its last row's whole. */
    get capacity() {
      return table.capacity
    },
    write,
    writeTexels,
    /** Field `field` as a byte target: `size` bytes of `data` from `dataOffset`, at byte `offset` of
     *  the field's line of texels (`texelPieces`) — whole texels. */
    target(field: string) {
      return (offset: number, data: ArrayBuffer, dataOffset: number, size: number) =>
        writeTexels(field, offset / bytes, size / bytes, data, dataOffset)
    },
    /**
     * A table that holds `wanted` records: this one, or one made larger — twice the last at
     * least, so a growth costs a constant a record —, its records copied once on the GPU in the
     * queue's order, the texture replaced retired (`retire`). Whether it holds them: a growth its
     * maker refuses keeps the table it had.
     */
    hold(wanted: number) {
      if (wanted <= table.capacity) return true
      const old = table
      try {
        table = made(Math.max(wanted, 2 * old.capacity))
      } catch {
        return false
      }
      const encoder = device.createCommandEncoder({ label: `${layout.label} growth` })
      encoder.copyTextureToTexture({ texture: old.texture }, { texture: table.texture }, old.size)
      device.queue.submit([encoder.finish()])
      retire(device, old.texture)
      return true
    },
    destroy: () => table.texture.destroy(),
  }
}
export type RecordTexture = ReturnType<typeof createRecordTexture>
