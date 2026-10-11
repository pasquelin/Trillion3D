import { alignUp } from '../../../packages/math/src/scalar/integers.ts'
import * as format from '../../../packages/sdk-core/src/manifest/binaryFormat.ts'
import {
  columnElements,
  type Counts,
} from '../../../packages/sdk-core/src/manifest/binaryLayout.ts'

function columnBytes(name: format.ColumnName, counts: Counts) {
  return (
    columnElements(name, counts) *
    format.COLUMN_STRIDE[name] *
    format.BYTES_PER_ELEMENT[format.COLUMN_KIND[name]]
  )
}

/** Byte ranges of every column, in the fixed order of this version. */
export function manifestBinaryRanges(counts: Counts) {
  const ranges: Record<format.ColumnName, { offset: number; length: number }> = {} as Record<
    format.ColumnName,
    { offset: number; length: number }
  >
  let offset = alignUp(
    (format.MANIFEST_BINARY_HEADER_WORDS + format.COLUMN_NAMES.length * 2) * 4,
    8,
  )
  for (const name of format.COLUMN_NAMES) {
    const length = columnBytes(name, counts)
    ranges[name] = { offset, length }
    offset = alignUp(offset + length, 8)
  }
  return { ranges, bytes: offset }
}
