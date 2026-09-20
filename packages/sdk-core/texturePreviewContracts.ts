import type { TextureBlockFormat } from './manifestBinaryFormat.ts';

/**
 * The mip chain of an atlas texture: the tail in the sidecar — from the first level where no
 * side exceeds PREVIEW_BASE down to 1x1, in RGBA8 in its atlas encoding and in each block
 * format — and, above it, bakedLevels files per format in the cache, one per level from 0 to
 * bakedLevels - 1, at the address templated by ClusterManifest.textures.url.
 */
export interface TexturePreview {
  /** Index in the textures array of the prepared scene. */
  texture: number;
  /** Index in its images array, where the source uri is read when present. */
  image: number;
  width: number;
  height: number;
  /** 0 when bytes came from an image uri, 1 when they came from sourceBufferView. */
  sourceKind: number;
  /** Buffer view of the prepared scene, or -1 for a uri source. */
  sourceBufferView: number;
  /** SHA-256 of decoded source bytes. */
  sha256: string;
  /** The atlas this entry serves: PREVIEW_ATLAS_COLOR or PREVIEW_ATLAS_DATA. */
  atlas: number;
  /** Index of the first level carried in the source's mip chain; 0 when it already fits
   *  under PREVIEW_BASE and the sidecar thus carries its full resolution. */
  firstLevel: number;
  /** Levels baked into files in the cache, from 0 to bakedLevels - 1; firstLevel when the
   *  chain is complete, 0 when nothing was written and the engine loads the source image. */
  bakedLevels: number;
  /** Levels carried in order, from finest to 1x1, each a view on sidecar bytes. */
  levels: Uint8Array<ArrayBuffer>[];
  /** The same levels block-compressed, one list per format, each level whole 4x4 blocks. */
  blocks: Record<TextureBlockFormat, Uint8Array<ArrayBuffer>[]>;
}
