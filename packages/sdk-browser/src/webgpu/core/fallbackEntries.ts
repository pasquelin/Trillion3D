import { bufferEntry } from './liveEntries.ts';
import { UNIFORM_STRIDE } from '../blend/uniforms.ts';

/** Shared fallback contract for opaque and transparent draws. Readers are mounted once. */
export function fallbackBindEntries(
  indices: () => GPUBuffer | undefined,
  position: () => GPUBuffer | undefined,
  uniform: () => GPUBuffer | undefined,
) {
  return [
    bufferEntry(0, indices),
    bufferEntry(1, position),
    bufferEntry(2, uniform, undefined, () => UNIFORM_STRIDE),
  ];
}
