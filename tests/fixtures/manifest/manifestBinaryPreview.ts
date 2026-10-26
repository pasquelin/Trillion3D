// The lossless preview entry both manifest preview tests build on, and the level fixtures it
// needs: kept apart from `manifestBinary.ts` so that file stays under the line budget.
import type { TexturePreview } from '../../../packages/sdk-core/src/texture/previewContracts.ts'
import { sha } from './manifestBinary.ts'
import { previewLevels } from './manifestBinaryLevels.ts'
import {
  previewFirstLevel,
  previewGeometry,
} from '../../../packages/sdk-core/src/texture/previewLevels.ts'
import { PREVIEW_ATLAS_HDR } from '../../../packages/sdk-core/src/texture/previewFormat.ts'
/** One texture preview entry, lossless by default: the shape both preview tests build on. */
export function preview(
  texture: number,
  width: number,
  height: number,
  seed: number,
): TexturePreview {
  return {
    texture,
    image: texture,
    width,
    height,
    sourceKind: 0,
    sourceBufferView: -1,
    atlas: 0,
    bakedLevels: 0,
    sha256: sha(String(texture)),
    firstLevel: previewFirstLevel(width, height),
    ...previewLevels(width, height, seed),
  }
}
/** A half-float entry: the same shape, its tail eight bytes a texel and held by no block family. */
export function hdrPreview(
  texture: number,
  width: number,
  height: number,
  seed: number,
): TexturePreview {
  const levels = previewGeometry(width, height, 8).sizes.map(
    ([w, h], index) =>
      new Uint8Array(w * h * 8).map(
        (_byte, i) => (i + index + seed) % 256,
      ) as Uint8Array<ArrayBuffer>,
  )
  return {
    ...preview(texture, width, height, seed),
    atlas: PREVIEW_ATLAS_HDR,
    levels,
    layouts: { bc7: 'lossless', astc: 'lossless', etc2: 'lossless' },
    blocks: { bc7: [], astc: [], etc2: [] },
  }
}
