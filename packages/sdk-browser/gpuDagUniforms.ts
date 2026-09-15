import type { PackedDag } from './gpuDagTypes.ts';
import type { SelectionResult, SelectionUniforms } from './gpuSelection.ts';

export function writeDagUniforms(
  target: Float32Array,
  packed: PackedDag,
  uniforms: SelectionUniforms,
  residentCut: boolean,
) {
  target.fill(0);
  target.set(uniforms.planes, 0);
  target.set(uniforms.view, 24);
  target[40] = uniforms.pixelScale[0];
  target[41] = uniforms.pixelScale[1];
  target[42] = uniforms.pixelError;
  target[43] = uniforms.near;
  const ints = new Uint32Array(target.buffer, target.byteOffset, target.length);
  ints[44] = packed.pageCount;
  ints[45] = packed.nodeCount;
  ints[46] = packed.worldCount;
  ints[47] = residentCut ? 1 : 0;
  const cw = uniforms.cameraWorld;
  if (cw) {
    target[48] = cw[0];
    target[49] = cw[1];
    target[50] = cw[2];
  }
  target[51] = uniforms.cameraStretch ?? 1;
}

export function parseDagOutput(
  bytes: ArrayBufferLike,
  byteOffset: number,
  byteLength: number,
  maskPageCount: number,
): SelectionResult | null {
  const ints = new Uint32Array(bytes, byteOffset, Math.floor(byteLength / 4));
  if (((ints[3] ?? 0) & 1) !== 0) return null;
  const count = Math.min(ints[0] ?? 0, Math.max(0, ints.length - 4 - maskPageCount));
  // Tableaux dimensionnés d'avance : la lecture d'une image ne fait pas croître un tableau vide
  // élément par élément, et l'itérateur d'un tableau typé n'est jamais déroulé.
  const pageIds = new Array<number>(count);
  for (let i = 0; i < count; i++) pageIds[i] = ints[4 + i];
  const result: SelectionResult = {
    pageIds,
    frustumRejected: ints[1] ?? 0,
    lodLevel: ints[2] ?? 0,
    complete: ((ints[3] ?? 0) & 2) === 0,
  };
  if (maskPageCount) {
    const drawable = new Array<number>(maskPageCount),
      offset = ints.length - maskPageCount;
    let found = 0;
    for (let i = 0; i < maskPageCount; i++) if (ints[offset + i]) drawable[found++] = i;
    drawable.length = found;
    result.drawablePageIds = drawable;
  }
  return result;
}
