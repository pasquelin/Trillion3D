import { EngineError, type ClusterManifest } from '../contracts/index.ts';
import {
  BYTES_PER_ELEMENT,
  COLUMN_KIND,
  COLUMN_NAMES,
  COLUMN_STRIDE,
  MANIFEST_BINARY_HEADER_WORDS,
  PREVIEW_BLOCK_FORMATS,
  type ColumnName,
  type TextureBlockFormat,
} from './binaryFormat.ts';
import { previewBlockBytes, previewPixelBytes } from '../texture/previewLevels.ts';

const digestRefuse = (sha: string) =>
  new EngineError(
    'INVALID_CACHE',
    'A cache object digest is not 64 lowercase hexadecimal characters',
    { sha256: sha },
  );
const align8 = (value: number) => (value + 7) & ~7;

/** The 64 bytes of a digest, filled then stored: nothing is written if the digest is rejected. */
const digestScratch = new Uint8Array(64);

/**
 * A digest as its 64 ASCII hexadecimal characters, at its slot in a sha column. Validation reads the
 * codes once and keeps them: a regular expression used to walk the digest, then the write loop
 * walked it again, for each of the tens of thousands of pages in a manifest.
 */
export function writeSha(target: Uint8Array, slot: number, sha: string) {
  if (sha.length !== 64) throw digestRefuse(sha);
  for (let i = 0; i < 64; i++) {
    const code = sha.charCodeAt(i);
    if (!((code >= 48 && code <= 57) || (code >= 97 && code <= 102))) throw digestRefuse(sha);
    digestScratch[i] = code;
  }
  target.set(digestScratch, slot * 64);
}
/** Every object url a sidecar names follows its template; a cache where one does not is rejected. */
export function expectTemplate(template: string, url: string, sha: string) {
  if (template.replace('{sha}', sha) !== url)
    throw new EngineError(
      'INVALID_CACHE',
      'A cache object url does not follow the manifest template',
      {
        url,
        template,
      },
    );
}

/** How many rows each part of a binary manifest holds. */
export interface Counts {
  /** Pages. */
  pages: number;
  /** Culling nodes. */
  cullingNodes: number;
  /** Groups. */
  groups: number;
  /** Group children. */
  children: number;
  /** Group outputs. */
  outputs: number;
  /** Roots. */
  roots: number;
  /** Bundles. */
  bundles: number;
  /** Bundle dependencies, every bundle's list concatenated. */
  bundleDependencies: number;
  /** Texture previews. */
  previews: number;
  /** Bytes of the pixel column, every level of every entry concatenated. */
  previewBytes: number;
  /** Bytes of each block column: the kept chains' tails compressed, whole blocks, entries
   *  contiguous, nothing for a chain the family left lossless. */
  previewBlockBytes: Record<TextureBlockFormat, number>;
}
export function countManifest(manifest: ClusterManifest): Counts {
  const previews = manifest.texturePreviews ?? [];
  const counts: Counts = {
    pages: 0,
    cullingNodes: 0,
    groups: 0,
    children: 0,
    outputs: 0,
    roots: 0,
    bundles: 0,
    bundleDependencies: 0,
    previews: previews.length,
    previewBytes: previews.reduce(
      (bytes, preview) => bytes + previewPixelBytes(preview.width, preview.height),
      0,
    ),
    previewBlockBytes: { bc7: 0, astc: 0 },
  };
  for (const preview of previews)
    for (const name of PREVIEW_BLOCK_FORMATS)
      if (preview.layouts[name] !== 'lossless')
        counts.previewBlockBytes[name] += previewBlockBytes(preview.width, preview.height);
  for (const primitive of manifest.primitives) {
    counts.pages += primitive.pages.length;
    counts.cullingNodes += primitive.culling?.count ?? 0;
    for (const group of primitive.structure?.groups ?? []) {
      counts.groups++;
      counts.children += group.children.length;
      counts.outputs += group.outputs.length;
    }
    counts.roots += primitive.structure?.roots.length ?? 0;
    for (const bundle of primitive.streams?.pages ?? []) {
      counts.bundles++;
      counts.bundleDependencies += bundle.dependencies.length;
    }
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
    case 'pageDepthLayer':
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
    case 'bundleDependencyCount':
      return counts.bundles;
    case 'bundleDependency':
      return counts.bundleDependencies;
    case 'texturePreviewU32':
    case 'texturePreviewSha':
      return counts.previews;
    case 'texturePreviewPixels':
      return counts.previewBytes;
    case 'texturePreviewBc7':
      return counts.previewBlockBytes.bc7;
    case 'texturePreviewAstc':
      return counts.previewBlockBytes.astc;
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
