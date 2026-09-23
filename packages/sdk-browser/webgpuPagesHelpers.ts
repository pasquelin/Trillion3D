import { rgbHex } from '../sdk-core/src/world/math/packedColour.ts';
import { hslToLinearRgb, srgbToLinear } from '../sdk-core/src/index.ts';
import type { PageRec } from './pageSelection.ts';
import { clusterHue } from './diagnosticColors.ts';
import { pageAddress } from './webgpuPageSlots.ts';
import type { VisMaterial } from './visibilityTypes.ts';

/** View-projection of the image as the GPU reads it, flattened: sixteen floats rewritten each
 *  image, never reallocated. */
export const viewProj = new Float64Array(16);
/** Three linear components reread immediately: a diagnostic colour allocates nothing more. */
const tint = new Float64Array(3);
export const PAGES_GREEN: [number, number, number] = [0.204, 0.827, 0.6];
/** Ceiling on the screen error the GPU page budget may impose; past it the root cover is the cut. */
export const MAX_BUDGET_PIXEL_ERROR = 4096;

/** First GPU readback evidence: requested clear versus two actual pixels from the color target. */
export function outputColorDiagnostic(
  pixels: Uint8Array,
  width: number,
  height: number,
  clearColor: number,
  origin: 'top-left' | 'bottom-left' = 'top-left',
) {
  const pixel = (x: number, y: number) => {
    const offset = ((origin === 'bottom-left' ? height - 1 - y : y) * width + x) * 4;
    return rgbHex(pixels[offset] ?? 0, pixels[offset + 1] ?? 0, pixels[offset + 2] ?? 0);
  };
  const clearHex = `#${clearColor.toString(16).padStart(6, '0')}`;
  const topLeft = pixel(0, 0),
    center = pixel(Math.floor(width / 2), Math.floor(height / 2));
  return { clearColor: clearHex, topLeft, center, matchesClearAtTopLeft: topLeft === clearHex };
}

/** Base colour of a declaration through the transfer curve, for the fallback draw's uniform.
 *  The curve is the repository's (`mathColor.ts`), whose gap to the host library's rounded
 *  constants is measured and declared (#72); no beauty pass reads this path. */
export function linearColor(surface: VisMaterial): [number, number, number] {
  const base = surface.baseColor;
  return [srgbToLinear(base[0]), srgbToLinear(base[1]), srgbToLinear(base[2])];
}
/** Diagnostic colour of a cluster: its golden-ratio hue, through the same transfer curve. */
export function clusterRgb(id: string): [number, number, number] {
  hslToLinearRgb(tint, 0, clusterHue(id), 0.75, 0.55);
  return [srgbToLinear(tint[0]), srgbToLinear(tint[1]), srgbToLinear(tint[2])];
}

/** Sum of a cut's triangles, without the closure a `reduce` allocates on every frame. */
export function triangleSum(pages: readonly PageRec[], transparent?: boolean) {
  let total = 0;
  for (let i = 0; i < pages.length; i++)
    if (transparent === undefined || !!pages[i].transparent === transparent)
      total += pages[i].triangles;
  return total;
}
/** Copies the records of `source` whose transparency matches, into an array the caller owns. */
export function partitionByPass(source: readonly PageRec[], transparent: boolean, into: PageRec[]) {
  into.length = 0;
  for (let i = 0; i < source.length; i++)
    if (!!source[i].transparent === transparent) into.push(source[i]);
  return into;
}
type DrawnMirror = { shown: PageRec[]; drawn: PageRec[]; drawnMirrorsShown: boolean };
type DrawnMirrorFlag = Pick<DrawnMirror, 'drawnMirrorsShown'>;
/**
 * Sole owner of the `drawnMirrorsShown` flag: true when `drawn` is the copy of `shown` as it
 * stands. On the GPU path, `drawn` is nothing else: adoption remakes it when the readback
 * changes, resume after a surface capture too, and the CPU cut marks the divergence at its
 * entry because it is the only one that writes these lists another way. These functions are the
 * only ones that write the flag, initial value included: nothing is copied yet, the first image
 * will do it.
 */
export const unmirroredDrawn = (): DrawnMirrorFlag => ({ drawnMirrorsShown: false });
/** `drawn` has just been remade from `shown` by the caller itself. */
export function markDrawnMirrored(run: DrawnMirrorFlag) {
  run.drawnMirrorsShown = true;
}
/** `drawn` will be written other than by copy: the next image will have to remake it. */
export function markDrawnDiverged(run: DrawnMirrorFlag) {
  run.drawnMirrorsShown = false;
}
/** Copies `source` into `target`, rank by rank: neither push, nor a prior clear. */
export function copyPages<T>(target: T[], source: readonly T[]) {
  for (let i = 0; i < source.length; i++) target[i] = source[i];
  target.length = source.length;
}
/** Remakes `drawn` from `shown`, whether the flag is raised or not. */
export function copyDrawnFromShown(run: DrawnMirror) {
  copyPages(run.drawn, run.shown);
  markDrawnMirrored(run);
}
/** Remakes `drawn` from `shown` if it is no longer the copy of it; returns true if it did. */
export function mirrorDrawnFromShown(run: DrawnMirror) {
  if (run.drawnMirrorsShown) return false;
  copyDrawnFromShown(run);
  return true;
}
/** Spread arguments overflow the call stack beyond ~100k pages; append with a loop instead. */
export function appendAll<T>(target: T[], ...sources: readonly (readonly T[])[]) {
  for (const source of sources) for (let i = 0; i < source.length; i++) target.push(source[i]);
}
/** The pool addresses of a cut — each one a page url — for the trace sets. */
export const urlsOf = (pages: readonly PageRec[]) => pages.map(pageAddress);
