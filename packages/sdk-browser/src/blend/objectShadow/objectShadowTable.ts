import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import {
  OBJECT_SHADOW_PACKED_LAYER_ROWS as LAYER_ROWS,
  OBJECT_SHADOW_PACKED_WIDTH as WIDTH,
} from '../../gpu/core/objectShadowRead.ts'

/**
 * THE PACKED TABLE AS A 2D ARRAY (`OBJECT_SHADOW_PACKED_LAYER_ROWS`): the table's rows are numbered as if they lay one after the other, a row past a layer's end being
 * in the next layer. What it holds is written and copied into by row ranges, cut where a layer ends.
 */

/** A texel of the table: four words. */
const TEXEL_BYTES = 16
const ROW_BYTES = WIDTH * TEXEL_BYTES

/** The size of a table that holds `rows` rows at least and half again the `held` rows it had when it grows: one layer of that many lines, or whole layers of `LAYER_ROWS` lines, within the device's layers. */
export function packedTableSize(rows: number, held: number, maxLayers: number) {
  const wanted = Math.max(rows, Math.ceil(held * 1.5), 1)
  const layers = Math.min(ceilDiv(wanted, LAYER_ROWS), maxLayers)
  const height = layers > 1 ? LAYER_ROWS : wanted
  return { size: [WIDTH, height, layers] as [number, number, number], rows: height * layers }
}

/** Where row `row` lies: its line and its layer. */
const placeOf = (row: number) => ({ y: row % LAYER_ROWS, z: Math.floor(row / LAYER_ROWS) })

/** `rows` rows of `data` (words, `ROW_BYTES` a row) written from row `first`, one write a layer. */
export function writeTableRows(
  device: GPUDevice,
  texture: GPUTexture,
  data: Uint32Array<ArrayBuffer>,
  first: number,
  rows: number,
) {
  for (let done = 0; done < rows;) {
    const { y, z } = placeOf(first + done)
    const count = Math.min(rows - done, LAYER_ROWS - y)
    device.queue.writeTexture(
      { texture, origin: { x: 0, y, z } },
      data,
      { offset: done * ROW_BYTES, bytesPerRow: ROW_BYTES },
      [WIDTH, count],
    )
    done += count
  }
}

/** `rows` rows of `width` texels copied from `buffer` (from `offset`, `bytesPerRow` a row, aligned to 256) into the table from row `first`, starting `x` texels across, one copy a layer. */
export function copyBufferToTableRows(
  encoder: GPUCommandEncoder,
  buffer: GPUBuffer,
  offset: number,
  bytesPerRow: number,
  texture: GPUTexture,
  width: number,
  first: number,
  rows: number,
  x = 0,
) {
  for (let done = 0; done < rows;) {
    const { y, z } = placeOf(first + done)
    const count = Math.min(rows - done, LAYER_ROWS - y)
    encoder.copyBufferToTexture(
      { buffer, offset: offset + done * bytesPerRow, bytesPerRow },
      { texture, origin: { x, y, z } },
      { width, height: count },
    )
    done += count
  }
}
