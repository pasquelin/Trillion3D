// Shared by `volumeFrustumCases.ts`: the frustum planes of a view-projection, at either precision
// the selection uses — double or single, chosen by caller.
import { frustumPlanesFromMatrix } from '../../../../packages/sdk-core/src/index.ts'

export function plans(vp: number[]): Float64Array
export function plans(vp: number[], Type: Float32ArrayConstructor): Float32Array
export function plans(
  vp: number[],
  Type: Float64ArrayConstructor | Float32ArrayConstructor = Float64Array,
): Float64Array | Float32Array {
  const output = new Type(24)
  frustumPlanesFromMatrix(output, vp)
  return output
}
