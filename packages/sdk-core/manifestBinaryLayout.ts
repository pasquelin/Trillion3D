import { EngineError, type ClusterManifest } from './contracts.ts';
import {
  BYTES_PER_ELEMENT,
  COLUMN_KIND,
  COLUMN_NAMES,
  COLUMN_STRIDE,
  MANIFEST_BINARY_HEADER_WORDS,
  type ColumnName,
} from './manifestBinaryFormat.ts';

export function hexDigits(sha: string) {
  if (sha.length !== 64 || !/^[0-9a-f]{64}$/.test(sha))
    throw new EngineError(
      'INVALID_CACHE',
      'A cache object digest is not 64 lowercase hexadecimal characters',
      { sha256: sha },
    );
  return sha;
}
const align8 = (value: number) => (value + 7) & ~7;

export interface Counts {
  pages: number;
  cullingNodes: number;
  groups: number;
  children: number;
  outputs: number;
  roots: number;
  bundles: number;
}
export function countManifest(manifest: ClusterManifest): Counts {
  const counts: Counts = {
    pages: 0,
    cullingNodes: 0,
    groups: 0,
    children: 0,
    outputs: 0,
    roots: 0,
    bundles: 0,
  };
  for (const primitive of manifest.primitives) {
    counts.pages += primitive.pages.length;
    counts.cullingNodes += primitive.culling?.count ?? 0;
    for (const group of primitive.structure?.groups ?? []) {
      counts.groups++;
      counts.children += group.children.length;
      counts.outputs += group.outputs.length;
    }
    counts.roots += primitive.structure?.roots.length ?? 0;
    counts.bundles += primitive.streams?.pages.length ?? 0;
  }
  return counts;
}
export function columnElements(name: ColumnName, counts: Counts) {
  switch (name) {
    case 'pageBounds':
    case 'pageSphere':
    case 'pageParentSphere':
    case 'pageError':
    case 'pageInt':
    case 'pageU32':
    case 'pageSha':
    case 'geometrySha':
    case 'geometryU32':
      return counts.pages;
    case 'cullingNodes':
      return counts.cullingNodes;
    case 'groupLevel':
    case 'groupError':
    case 'groupSphere':
    case 'groupChildCount':
    case 'groupOutputCount':
      return counts.groups;
    case 'groupChild':
      return counts.children;
    case 'groupOutput':
      return counts.outputs;
    case 'structureRoot':
      return counts.roots;
    case 'bundleU32':
    case 'bundleSha':
      return counts.bundles;
  }
}
function columnBytes(name: ColumnName, counts: Counts) {
  return columnElements(name, counts) * COLUMN_STRIDE[name] * BYTES_PER_ELEMENT[COLUMN_KIND[name]];
}

/** Byte ranges of every column, in the fixed order of this version. */
export function manifestBinaryRanges(counts: Counts) {
  const ranges: Record<ColumnName, { offset: number; length: number }> = {} as Record<
    ColumnName,
    { offset: number; length: number }
  >;
  let offset = align8((MANIFEST_BINARY_HEADER_WORDS + COLUMN_NAMES.length * 2) * 4);
  for (const name of COLUMN_NAMES) {
    const length = columnBytes(name, counts);
    ranges[name] = { offset, length };
    offset = align8(offset + length);
  }
  return { ranges, bytes: offset };
}
