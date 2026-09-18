// Oracle de l'uniforme de partition, réécrit d'après le contrat : un double devient un f32 haut
// plus un f32 de reste ; une matrice ancrée garde ses trois colonnes et voit sa translation
// recalculée à l'ancre ; les niveaux Hi-Z absents valent décalage 0 et largeur 1. La disposition
// vient du contrat, pour que l'oracle ne dérive pas en silence.
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

export function referenceSplitDouble(out, haut, bas, value) {
  out[haut] = value;
  out[bas] = value - out[haut];
}

function ancree(elements, anchor) {
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

export function referencePartitionUniform(frame, rows) {
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
      frame.historyValid ? 1 : 0,
      frame.hasRest ? 1 : 0,
      0,
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
