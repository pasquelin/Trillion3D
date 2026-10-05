import * as format from '../../packages/sdk-core/src/manifest/binaryFormat.ts';
import { columnElements, type Counts } from '../../packages/sdk-core/src/manifest/binaryLayout.ts';

const align8 = (value: number) => (value + 7) & ~7;

function columnBytes(name: format.ColumnName, counts: Counts) {
  return (
    columnElements(name, counts) *
    format.COLUMN_STRIDE[name] *
    format.BYTES_PER_ELEMENT[format.COLUMN_KIND[name]]
  );
}

/** Byte ranges of every column, in the fixed order of this version. */
export function manifestBinaryRanges(counts: Counts) {
  const ranges: Record<format.ColumnName, { offset: number; length: number }> = {} as Record<
    format.ColumnName,
    { offset: number; length: number }
  >;
  let offset = align8((format.MANIFEST_BINARY_HEADER_WORDS + format.COLUMN_NAMES.length * 2) * 4);
  for (const name of format.COLUMN_NAMES) {
    const length = columnBytes(name, counts);
    ranges[name] = { offset, length };
    offset = align8(offset + length);
  }
  return { ranges, bytes: offset };
}
