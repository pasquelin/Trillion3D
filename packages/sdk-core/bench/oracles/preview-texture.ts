// Oracle for point G11: geometry of a preview entry before batch G, copied as is.
import {
  previewFirstLevel,
  previewLastLevel,
  previewLevelSize,
} from '../../texturePreviewLevels.ts';

/** `texturePreviewLevels.ts`: each number restarted from the dimensions, without a shared bound. */
function referencePreviewPixelBytes(width: number, height: number) {
  let bytes = 0;
  const last = previewLastLevel(width, height);
  for (let level = previewFirstLevel(width, height); level <= last; level++) {
    const [w, h] = previewLevelSize(width, height, level);
    bytes += w * h * 4;
  }
  return bytes;
}

/** `manifestBinaryPreview.ts`: three public calls, hence five sweeps for two bounds. */
export function referenceExpectedGeometry(width: number, height: number) {
  return {
    firstLevel: previewFirstLevel(width, height),
    levelCount: previewLastLevel(width, height) - previewFirstLevel(width, height) + 1,
    pixelBytes: referencePreviewPixelBytes(width, height),
  };
}
