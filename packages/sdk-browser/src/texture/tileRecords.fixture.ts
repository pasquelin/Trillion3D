import { tilesAt } from './tiles.ts'
import { tileRecord } from './tileRecords.ts'

/** Bytes of a `width` × `height` block level file: where its last tile's record ends, the records
 *  lying end to end. */
export function tiledLevelBytes(width: number, height: number) {
  const [across, down] = tilesAt(width, height, 0)
  const { offset, bytes } = tileRecord(width, height, across - 1, down - 1)
  return offset + bytes
}
