import { deflateRawSync } from 'node:zlib'
import { tilesAt } from './tiles.ts'
import { tileRecord } from './tileRecords.ts'

/** Raw blocks of a record by default: its bytes counting from its rank, so a misplaced one shows. */
const counted = (index: number, bytes: number) =>
  Uint8Array.from({ length: bytes }, (_, i) => (index * 31 + i * 13) & 255)

/**
 * A `width` × `height` block level file as the compiler writes it (`tile_records`): each tile's
 * record — `record(rank, bytes)`, its blocks before compression — deflated alone, after the head of
 * their little-endian ends. Returns the file and the raw records, tile rows then tiles.
 */
export function tiledLevelFile(width: number, height: number, record = counted) {
  const [across, down] = tilesAt(width, height, 0)
  const records: Uint8Array[] = []
  for (let ty = 0; ty < down; ty++)
    for (let tx = 0; tx < across; tx++) {
      const { index, bytes } = tileRecord(width, height, tx, ty)
      records.push(record(index, bytes))
    }
  const packed = records.map((raw) => new Uint8Array(deflateRawSync(raw)))
  const head = new DataView(new ArrayBuffer(packed.length * 4))
  let end = 0
  packed.forEach((bytes, i) => head.setUint32(i * 4, (end += bytes.byteLength), true))
  const file = new Uint8Array(head.byteLength + end)
  file.set(new Uint8Array(head.buffer))
  let at = head.byteLength
  for (const bytes of packed) file.set(bytes, (at += bytes.byteLength) - bytes.byteLength)
  return { file, records }
}
