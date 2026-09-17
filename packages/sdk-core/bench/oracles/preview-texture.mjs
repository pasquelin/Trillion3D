// Oracle du point G11 : la géométrie d'une entrée de preview avant le lot G, recopiée telle quelle.
import {
  previewFirstLevel,
  previewLastLevel,
  previewLevelSize,
} from '../../texturePreviewLevels.ts';

/** `texturePreviewLevels.ts` : chaque nombre repartait des dimensions, sans borne partagée. */
function referencePreviewPixelBytes(width, height) {
  let bytes = 0;
  const last = previewLastLevel(width, height);
  for (let level = previewFirstLevel(width, height); level <= last; level++) {
    const [w, h] = previewLevelSize(width, height, level);
    bytes += w * h * 4;
  }
  return bytes;
}

/** `manifestBinaryPreview.ts` : trois appels publics, donc cinq balayages pour deux bornes. */
export function referenceExpectedGeometry(width, height) {
  return {
    firstLevel: previewFirstLevel(width, height),
    levelCount: previewLastLevel(width, height) - previewFirstLevel(width, height) + 1,
    pixelBytes: referencePreviewPixelBytes(width, height),
  };
}
