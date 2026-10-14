import { arrayView } from './textureViews.ts'
import { grownByCopy } from './tableGrowth.ts'

import {
  heldRecords,
  recordExtent,
  texelAt,
  texelBytes,
  texelPieces,
  type PieceVisit,
  type RecordLayout,
} from './recordLayout.ts'

/** Makes a record texture's texture, `bytes` large, in place of `old` when it replaces one. */
export type TextureMaker = (
  descriptor: GPUTextureDescriptor,
  bytes: number,
  old?: GPUTexture,
) => GPUTexture

/**
 * A record table made on `device` for `records` records — none still a row's worth —: its texture
 * and the view every pass binds (`2d-array`, whatever its layers), and the writes of the host — a
 * run of records' field from the bytes that hold it, or through a byte target (`target`), what the
 * cut's run writer sends (`../dag/runWrites.ts`, `writeRanges`). `usage` is the texture's, the
 * caller's: a GPU writer adds `STORAGE_BINDING`, a table that grows (`hold`) `COPY_SRC`. `make`
 * creates it, `bytes` large: an owner's admission and ledger (`../dag/resources.ts`).
 *
 * A table grows in place of a second one beside it (`hold`): made larger, the records it held
 * copied on the GPU once, submitted at once — behind every host write sent to it, ahead of any
 * command the frame's encoder holds, so it grows before that encoder records a GPU write to it —,
 * the one replaced retired after the frame that may name it (`grownByCopy`). Its texture and view
 * are then new: every group that binds it follows the view's identity
 * (`createWebgpuBindIdentity`).
 */
export function createRecordTexture(
  device: GPUDevice,
  layout: RecordLayout,
  records: number,
  usage: GPUTextureUsageFlags,
  make: TextureMaker = (descriptor) => device.createTexture(descriptor),
) {
  const bytes = texelBytes(layout.format)
  /** The texture of `count` records, made by `make` in place of `old` when it replaces one. */
  const made = (count: number, old?: GPUTexture) => {
    const size = recordExtent(layout, count),
      held = size[0] * size[1] * size[2] * bytes
    const texture = make({ label: layout.label, size, format: layout.format, usage }, held, old)
    return { texture, size, held, view: arrayView(texture), capacity: heldRecords(layout, size) }
  }
  let table = made(records)
  /** One write's descriptors, held and filled again at each piece: the queue reads them when called,
   *  so a write allocates nothing. */
  const origin = [0, 0, 0],
    extent = [0, 0, 1],
    destination: GPUTexelCopyTextureInfo = { texture: table.texture, origin },
    source: GPUTexelCopyBufferLayout = { offset: 0, bytesPerRow: 0 },
    none = new ArrayBuffer(0),
    sending = { data: none, dataOffset: 0, first: 0 }
  const send: PieceVisit = (x, y, layer, width, rows, first) => {
    origin[0] = x
    origin[1] = y
    origin[2] = layer
    extent[0] = width
    extent[1] = rows
    source.offset = sending.dataOffset + (first - sending.first) * bytes
    device.queue.writeTexture(destination, sending.data, source, extent)
  }
  /** Texels `[first, first + count)` of field `field` (`texelPieces`), `data` holding them from
   *  `dataOffset` bytes, one after the other. */
  const writeTexels = (
    field: string,
    first: number,
    count: number,
    data: ArrayBuffer,
    dataOffset: number,
  ) => {
    destination.texture = table.texture
    source.bytesPerRow = (layout.fields[field] << layout.rowShift) * bytes
    sending.data = data
    sending.dataOffset = dataOffset
    sending.first = first
    texelPieces(layout, field, first, count, send)
    // The caller's bytes are not held past its write.
    sending.data = none
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
     * least, so a growth costs a constant a record —, its records copied once on the GPU and the
     * texture replaced retired, by the one growth's release (`grownByCopy`, whose order it
     * keeps). Whether it holds them: a growth its maker refuses keeps the table it had.
     */
    hold(wanted: number) {
      if (wanted <= table.capacity) return true
      const old = table
      try {
        table = made(Math.max(wanted, 2 * old.capacity), old.texture)
      } catch {
        return false
      }
      grownByCopy(
        device,
        [old.texture],
        (encoder) =>
          encoder.copyTextureToTexture(
            { texture: old.texture },
            { texture: table.texture },
            old.size,
          ),
        `${layout.label} growth`,
      )
      return true
    },
    /** Texels `[from, from + count)` of field `field` copied, in `encoder`, to texels from `at` of
     *  the same field of `to`, a table of the same layout: a row's run a copy. */
    copyTexels(
      encoder: GPUCommandEncoder,
      to: { texture: GPUTexture },
      field: string,
      from: number,
      at: number,
      count: number,
    ) {
      for (let t = 0; t < count;) {
        const source = texelAt(layout, field, from + t),
          target = texelAt(layout, field, at + t),
          width = Math.min(count - t, source.left, target.left)
        encoder.copyTextureToTexture(
          { texture: table.texture, origin: source.origin },
          { texture: to.texture, origin: target.origin },
          [width, 1, 1],
        )
        t += width
      }
    },
    destroy: () => table.texture.destroy(),
  }
}
export type RecordTexture = ReturnType<typeof createRecordTexture>
