// Shared by `volumesCasTronc.ts`: the frustum planes of a view-projection, at either precision
// the selection uses — the WebGL2 path always double, the WebGPU path either, chosen by caller.
import { frustumPlanesFromMatrix } from '../../../../packages/sdk-core/src/index.ts';

export function plans(vp: number[], webgpu: boolean): Float64Array;
export function plans(vp: number[], webgpu: boolean, Type: Float32ArrayConstructor): Float32Array;
export function plans(
  vp: number[],
  webgpu: boolean,
  Type: Float64ArrayConstructor | Float32ArrayConstructor = Float64Array,
): Float64Array | Float32Array {
  const output = new Type(24);
  frustumPlanesFromMatrix(output, vp);
  return output;
}
