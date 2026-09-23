import { outputColorDiagnostic } from '../webgpu/pages/helpers.ts';

/** A bounded evidence record for the final WebGL composition used by captures and reports. */
export function presentationColorDiagnostic(
  pixels: Uint8Array,
  width: number,
  height: number,
  clearColor: number,
  surface = 'webgl-capture-target',
) {
  return { ...outputColorDiagnostic(pixels, width, height, clearColor, 'top-left'), surface };
}
