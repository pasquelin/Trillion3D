const rgbHex = (red: number, green: number, blue: number) =>
  `#${[red, green, blue].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
/** A bounded evidence record for the final WebGL composition used by captures and reports. */
export function presentationColorDiagnostic(
  pixels: Uint8Array,
  width: number,
  height: number,
  clearColor: number,
  surface = 'webgl-capture-target',
) {
  const pixel = (x: number, y: number) => {
    const offset = (y * width + x) * 4;
    return rgbHex(pixels[offset] ?? 0, pixels[offset + 1] ?? 0, pixels[offset + 2] ?? 0);
  };
  const clearHex = `#${clearColor.toString(16).padStart(6, '0')}`;
  const topLeft = pixel(0, 0),
    center = pixel(Math.floor(width / 2), Math.floor(height / 2));
  return {
    clearColor: clearHex,
    topLeft,
    center,
    matchesClearAtTopLeft: topLeft === clearHex,
    surface,
  };
}
