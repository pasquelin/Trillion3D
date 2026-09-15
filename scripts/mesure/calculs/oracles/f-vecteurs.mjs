// Oracles du lot F, côté vecteurs de sdk-core : `lightingSceneMath.ts:15`,
// `lightingTransportValidation.ts:68` et `sceneLightShadowFaces.ts:95-102` recopiés tels quels.

/** `lightingSceneMath.ts` avant le lot F : la longueur passait par un étalement d'arguments. */
export const referenceLength = (v) => Math.hypot(...v);

/** `lightingTransportValidation.ts` avant le lot F : même étalement sur la normale d'une facette. */
export const referenceNorme = (normal) => Math.hypot(...normal);

/** `sceneLightShadowFaces.ts` avant le lot F : trois boucles imbriquées et un accumulateur. */
export function referenceMultiply4(out, outBase, a, aBase, b, bBase, scratch) {
  for (let column = 0; column < 4; column++)
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[aBase + k * 4 + row] * b[bBase + column * 4 + k];
      scratch[column * 4 + row] = sum;
    }
  for (let i = 0; i < 16; i++) out[outBase + i] = scratch[i];
}
