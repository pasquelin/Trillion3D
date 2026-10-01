import { MAX_SHADOW_SLICES } from '../light/contracts.ts';

/**
 * Per slice, the last frame a light-wide invalidation ran while the GPU maps pages — a pool scan
 * reaches the host's mapped pages alone, never an entry the GPU drew and the host has not adopted
 * —, or its sun's depth range changed: a GPU draw before it is not adopted current (`mirror.ts`,
 * #831).
 */
export function createLightWideStamps() {
  const at = new Float64Array(MAX_SHADOW_SLICES).fill(-Infinity),
    rangeSeen = new Int32Array(MAX_SHADOW_SLICES).fill(-1);
  return {
    at,
    /** The sun of `slice` holds depth range `current` at `frame`, the GPU mapping or not. */
    sunRange(slice: number, current: number, gpuDraws: boolean, frame: number) {
      if (gpuDraws && current !== rangeSeen[slice]) at[slice] = frame;
      rangeSeen[slice] = current;
    },
  };
}
