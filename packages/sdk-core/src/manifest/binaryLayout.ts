import { PREVIEW_BLOCK_FORMATS, type ColumnName, type TextureBlockFormat } from './binaryFormat.ts'

/** How many rows each part of a binary manifest holds. */
export interface Counts {
  /** Pages. */
  pages: number
  /** Culling nodes. */
  cullingNodes: number
  /** Groups. */
  groups: number
  /** Group children. */
  children: number
  /** Group outputs. */
  outputs: number
  /** Roots. */
  roots: number
  /** Bundles. */
  bundles: number
  /** Bundle dependencies, every bundle's list concatenated. */
  bundleDependencies: number
  /** Texture previews. */
  previews: number
  /** Bytes of the pixel column, every level of every entry concatenated. */
  previewBytes: number
  /** Bytes of each block column: the kept chains' tails compressed, whole blocks, entries
   *  contiguous, nothing for a chain the family left lossless. */
  previewBlockBytes: Record<TextureBlockFormat, number>
}
/** Which row count each column holds one element per: a part of `Counts`, or a block format's bytes. */
type RowCount = Exclude<keyof Counts, 'previewBlockBytes'> | TextureBlockFormat

const COLUMN_ROWS: Record<ColumnName, RowCount> = {
  pageBounds: 'pages',
  pageSphere: 'pages',
  pageParentSphere: 'pages',
  pageError: 'pages',
  pageInt: 'pages',
  pageU32: 'pages',
  pageSha: 'pages',
  geometrySha: 'pages',
  geometryU32: 'pages',
  pageDepthLayer: 'pages',
  pageCone: 'pages',
  cullingNodes: 'cullingNodes',
  groupLevel: 'groups',
  groupError: 'groups',
  groupSphere: 'groups',
  groupChildCount: 'groups',
  groupOutputCount: 'groups',
  groupChild: 'children',
  groupOutput: 'outputs',
  structureRoot: 'roots',
  bundleU32: 'bundles',
  bundleSha: 'bundles',
  bundleDependencyCount: 'bundles',
  bundleDependency: 'bundleDependencies',
  texturePreviewU32: 'previews',
  texturePreviewSha: 'previews',
  texturePreviewPixels: 'previewBytes',
  texturePreviewBc7: 'bc7',
  texturePreviewAstc: 'astc',
  texturePreviewEtc2: 'etc2',
}

/** Whether a row count is a block family's bytes. */
const isFamily = (rows: RowCount): rows is TextureBlockFormat =>
  (PREVIEW_BLOCK_FORMATS as readonly string[]).includes(rows)

/** The element count of column `name`: its row count's part of `counts`. */
export function columnElements(name: ColumnName, counts: Counts) {
  const rows = COLUMN_ROWS[name]
  return isFamily(rows) ? counts.previewBlockBytes[rows] : counts[rows]
}
