// Oracles purs de A11, sans effet de bord : `residence.bench.mjs` les mesure, les tests unitaires
// les importent comme référence.
const CONE_FLOATS = 12,
  FLAG = 11;

/** `gpuDagRuntime.ts:94-101` avant le lot A : la colonne de résidence lue à travers les cônes. */
export function referenceUpdateResidency(next, pageCones) {
  let changed = false;
  for (let j = 0; j < next.length; j++) {
    const index = j * CONE_FLOATS + FLAG,
      value = next[j] ? 1 : 0;
    if (pageCones[index] !== value) {
      pageCones[index] = value;
      changed = true;
    }
  }
  return changed;
}

/** `gpuDagUniforms.ts:31-52` avant le lot A : spread d'un tableau typé et `push` sans capacité. */
export function referenceParseDagOutput(bytes, byteOffset, byteLength, maskPageCount) {
  const ints = new Uint32Array(bytes, byteOffset, Math.floor(byteLength / 4));
  if (((ints[3] ?? 0) & 1) !== 0) return null;
  const count = Math.min(ints[0] ?? 0, Math.max(0, ints.length - 4 - maskPageCount));
  const result = {
    pageIds: [...ints.subarray(4, 4 + count)],
    frustumRejected: ints[1] ?? 0,
    lodLevel: ints[2] ?? 0,
    complete: ((ints[3] ?? 0) & 2) === 0,
  };
  if (maskPageCount) {
    result.drawablePageIds = [];
    const offset = ints.length - maskPageCount;
    for (let i = 0; i < maskPageCount; i++) if (ints[offset + i]) result.drawablePageIds.push(i);
  }
  return result;
}
