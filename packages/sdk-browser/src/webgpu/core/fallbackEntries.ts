import { bufferEntry } from './liveEntries.ts';
import { UNIFORM_STRIDE } from '../blend/uniforms.ts';
import type { WebgpuPagesCore } from '../pages/runtime.ts';

/** Shared fallback contract for opaque and transparent draws: an item's own index and position
 *  buffers, else the page pool and the smallest buffer standing in for a position it never reads. */
export function fallbackBindEntries(
  rt: WebgpuPagesCore,
  item?: { readonly index?: GPUBuffer; readonly position?: GPUBuffer },
) {
  return [
    bufferEntry(0, () => item?.index ?? rt.gpu.cache?.buffer),
    bufferEntry(1, () => item?.position ?? rt.gpu.zeroUv),
    bufferEntry(2, () => rt.gpu.uniformBuffer, undefined, () => UNIFORM_STRIDE),
  ];
}
