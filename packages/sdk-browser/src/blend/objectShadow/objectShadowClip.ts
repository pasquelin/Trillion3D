import type { ObjectShadowProjection } from '../../lighting/shadows/perObject/objectShadowSetup.ts'

/**
 * The matrix of a projection in the world in metres: the world in centimetres under the pre-translation, then the inner frame's clip. The frame's
 * matrix is row-major, for row vectors, so its rows are the columns of the matrix a shader multiplies a column vector by.
 */
export function objectShadowClipMatrix(p: ObjectShadowProjection, out: Float32Array, at = 0) {
  const m = p.translatedWorldToClipInner
  for (let c = 0; c < 3; c++) for (let r = 0; r < 4; r++) out[at + c * 4 + r] = 100 * m[c * 4 + r]!
  for (let r = 0; r < 4; r++) {
    let sum = m[12 + r]!
    for (let c = 0; c < 3; c++) sum += p.preShadowTranslation[c]! * m[c * 4 + r]!
    out[at + 12 + r] = sum
  }
}
