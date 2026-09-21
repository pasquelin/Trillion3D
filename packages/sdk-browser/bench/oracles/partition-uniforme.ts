// Oracle of the partition uniform, rewritten from the contract: a double becomes a high f32
// plus a remainder f32; an anchored matrix keeps its three columns and sees its translation
// recomputed at the anchor; missing Hi-Z levels default to offset 0 and width 1. The layout
// comes from the contract, so the oracle does not drift in silence.
import {
  MAX_HIZ_LEVELS,
  UNIFORM_U32,
  UNI_ANCHOR,
  UNI_ANCHOR_LOW,
  UNI_LEVELS,
  UNI_SCALARS,
  UNI_VIEW,
  UNI_VIEW_PROJ,
} from '../../gpuPartitionContract.ts';
import type { ForgottenRows, PartitionFrame } from '../../gpuPartitionUniform.ts';

export function referenceSplitDouble(out: Float32Array, haut: number, bas: number, value: number) {
  out[haut] = value;
  out[bas] = value - out[haut];
}

function ancree(elements: ArrayLike<number>, anchor: readonly number[]) {
  const out = new Float32Array(16);
  for (let i = 0; i < 12; i++) out[i] = elements[i];
  for (let row = 0; row < 4; row++)
    out[12 + row] =
      elements[row] * anchor[0] +
      elements[4 + row] * anchor[1] +
      elements[8 + row] * anchor[2] +
      elements[12 + row];
  return out;
}

export function referencePartitionUniform(
  frame: PartitionFrame,
  rows: number,
  forget: ForgottenRows,
) {
  const f32 = new Float32Array(UNIFORM_U32),
    u32 = new Uint32Array(f32.buffer);
  f32.set(ancree(frame.view, frame.anchor), UNI_VIEW);
  f32.set(ancree(frame.viewProj, frame.anchor), UNI_VIEW_PROJ);
  for (let i = 0; i < 3; i++)
    referenceSplitDouble(f32, UNI_ANCHOR + i, UNI_ANCHOR_LOW + i, frame.anchor[i]);
  f32[UNI_ANCHOR + 3] = frame.near;
  f32[UNI_ANCHOR_LOW + 3] = 0;
  u32.set(
    [
      rows,
      frame.width,
      frame.height,
      Math.min(frame.levels.length, MAX_HIZ_LEVELS),
      frame.layerTop,
      frame.hasRest ? 1 : 0,
      frame.viewMoved ? 1 : 0,
      forget.to < forget.from ? 0 : forget.from,
      forget.to < forget.from ? 0 : forget.to + 1,
    ],
    UNI_SCALARS,
  );
  for (let level = 0; level < MAX_HIZ_LEVELS; level++) {
    const mip = frame.levels[level];
    u32[UNI_LEVELS + level] = mip ? mip.offset : 0;
    u32[UNI_LEVELS + MAX_HIZ_LEVELS + level] = mip ? mip.width : 1;
  }
  return u32;
}
