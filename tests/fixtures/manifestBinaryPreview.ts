// The lossless preview entry both manifest preview tests build on, and the level fixtures it
// needs: kept apart from `manifestBinary.ts` so that file stays under the line budget.
import type { TexturePreview } from '../../packages/sdk-core/contracts.ts';
import { previewLevels, sha } from './manifestBinary.ts';
import { previewFirstLevel } from '../../packages/sdk-core/texturePreviewLevels.ts';
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
  };
}
