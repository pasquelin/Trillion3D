// The image side of the default-backend proof: reading back a capture the case stored on
// `window`, and comparing two of them pixel for pixel. Runs in the browser through Playwright
// serialization, like the case itself.
/** A stored capture as a PNG data URL, rows flipped: `capture()` hands back bottom-left origin. */
export function defaultBackendCapturePng(key: string) {
  const bytes = window.proof?.images[key];
  if (!bytes) throw new Error('unknown capture');
  const width = 480;
  const height = bytes.length / 4 / width;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const image = new ImageData(width, height);
  for (let row = 0; row < height; row += 1) {
    const source = (height - 1 - row) * width * 4;
    for (let index = 0; index < width * 4; index += 1)
      image.data[row * width * 4 + index] = bytes[source + index];
  }
  canvas.getContext('2d')!.putImageData(image, 0, 0);
  return canvas.toDataURL('image/png');
}

/** Pixels of a stored capture that differ from its corner pixel, the cleared background: a
 *  capture where the scene appears has many of them, an empty canvas has none (#298). */
export function countDrawnPixels(key: string) {
  const bytes = window.proof?.images[key];
  if (!bytes) throw new Error('unknown capture');
  let drawn = 0;
  for (let index = 0; index < bytes.length; index += 4)
    for (let channel = 0; channel < 4; channel += 1)
      if (bytes[index + channel] !== bytes[channel]) {
        drawn += 1;
        break;
      }
  return { drawn, totalPixels: bytes.length / 4 };
}

/**
 * Pixels that differ between two stored captures: how many differ at all, how many differ by
 * more than a step an eye can see at this size, the largest channel gap and the mean one. Two
 * renderers evaluating two surface models never meet at zero; the shape of the difference says
 * whether they disagree on the shading or on the geometry.
 */
export function compareDefaultBackendCaptures(pair: [string, string]) {
  const store = window.proof;
  const a = store?.images[pair[0]];
  const b = store?.images[pair[1]];
  if (!a || !b || a.length !== b.length) throw new Error('captures are not comparable');
  let differentPixels = 0;
  let above8 = 0;
  let above32 = 0;
  let maxChannelDelta = 0;
  let sum = 0;
  for (let index = 0; index < a.length; index += 4) {
    let pixelDelta = 0;
    for (let channel = 0; channel < 4; channel += 1) {
      const delta = Math.abs(a[index + channel] - b[index + channel]);
      if (delta > pixelDelta) pixelDelta = delta;
    }
    if (pixelDelta > 0) differentPixels += 1;
    if (pixelDelta > 8) above8 += 1;
    if (pixelDelta > 32) above32 += 1;
    if (pixelDelta > maxChannelDelta) maxChannelDelta = pixelDelta;
    sum += pixelDelta;
  }
  const totalPixels = a.length / 4;
  return {
    differentPixels,
    above8,
    above32,
    maxChannelDelta,
    meanChannelDelta: Number((sum / totalPixels).toFixed(3)),
    totalPixels,
  };
}
