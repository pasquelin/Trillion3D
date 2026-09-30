import { residentBase, OUT_SELECTED_TRIANGLES, OUT_TRANSPARENT_TRIANGLES } from './layout.ts';

/**
 * One of the two residency columns returned to the oracle, one word per cluster: what the buffer
 * doubles read in the same cold buffer as the shader, instead of a rank copied on their side.
 */
export function residentFlags(
  bits: Uint32Array,
  pageCount: number,
  base = residentBase(pageCount),
) {
  return Uint32Array.from({ length: pageCount }, (_, page) =>
    residentBit(bits, base, page) ? 1 : 0,
  );
}

/**
 * The two triangle totals placed in the header, in the order THIS file fixes. `dagMask`
 * writes them on the GPU (`shader/totalsWgsl.ts`); anything that stands in for the GPU
 * must write them the same way, or else adoption — which reads the GPU first — would
 * take an empty header for a frame without triangles.
 */
export function writeTriangleTotals(
  ints: Uint32Array,
  totaux: {
    selectedTriangles?: number;
    transparentTriangles?: number;
  },
) {
  ints[OUT_SELECTED_TRIANGLES] = totaux.selectedTriangles ?? 0;
  ints[OUT_TRANSPARENT_TRIANGLES] = totaux.transparentTriangles ?? 0;
}

const residentBit = (bits: Uint32Array, base: number, page: number) =>
  (bits[base + (page >>> 5)] & (1 << (page & 31))) !== 0;
