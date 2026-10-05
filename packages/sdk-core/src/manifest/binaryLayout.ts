import { type ColumnName, type TextureBlockFormat } from './binaryFormat.ts';

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
    case 'pageCone':
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
