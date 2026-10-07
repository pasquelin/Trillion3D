import { rgbHex } from '../../../sdk-core/src/world/math/packedColour.ts'

/** First GPU readback evidence: requested clear versus two actual pixels from the color target. */
export function outputColorDiagnostic(
  pixels: Uint8Array,
  width: number,
  height: number,
  clearColor: number,
  origin: 'top-left' | 'bottom-left' = 'top-left',
) {
  const pixel = (x: number, y: number) => {
    const offset = ((origin === 'bottom-left' ? height - 1 - y : y) * width + x) * 4
    return rgbHex(pixels[offset] ?? 0, pixels[offset + 1] ?? 0, pixels[offset + 2] ?? 0)
  }
  const clearHex = `#${clearColor.toString(16).padStart(6, '0')}`
  const topLeft = pixel(0, 0),
    center = pixel(Math.floor(width / 2), Math.floor(height / 2))
  return { clearColor: clearHex, topLeft, center, matchesClearAtTopLeft: topLeft === clearHex }
}

/** A bounded evidence record for a captured image (`capture()`, bottom row first), read from the
 *  engine's WebGPU colour target. */
export function presentationColorDiagnostic(
  pixels: Uint8Array,
  width: number,
  height: number,
  clearColor: number,
) {
  return {
    ...outputColorDiagnostic(pixels, width, height, clearColor, 'bottom-left'),
    surface: 'webgpu-color-target',
  }
}
