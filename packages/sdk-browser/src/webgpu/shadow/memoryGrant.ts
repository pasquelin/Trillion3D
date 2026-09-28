import { SHADOW_POOL_BYTES } from '../../residency/memoryBudget.ts';
import { SHADOW_BATCH_GPU_BYTES } from '../../gpu/shadow/batchBudget.ts';

/** A memory-pressure event of the shadows, by name: the pool the device granted smaller than the
 *  grant asked (`pool-shrunk`, coarser pages) or refused at its floor (`pool-refused`, shadows
 *  off by name), the static layer past the grant (`static-layer-over-grant`) or refused by the
 *  device (`static-layer-refused`) — both leave the pages drawn whole, every caster at once. */
export type ShadowPressure =
  'pool-shrunk' | 'pool-refused' | 'static-layer-over-grant' | 'static-layer-refused';

/**
 * THE SHADOW MEMORY GRANT: the one fixed share the GPU budget gives the shadows
 * (`SHADOW_POOL_BYTES`), never a second budget, less the batches' reserve at their largest
 * (`SHADOW_BATCH_GPU_BYTES`), held beside the pool. The pool is drawn within it (`shadowPoolFor`);
 * a late allocation — the static layer, with the transmittance layer still to come — is asked of
 * it with what is already held (`admitShadowBytes`). What memory costs the image is said, never
 * hidden: each pressure is an event by name (`noteShadowPressure`), and `bias` the halvings of the
 * pool's bytes the device's refusals took — 0 whenever the device grants what the budget asks.
 * Nothing lowers it to meet a frame time.
 */
export type ShadowMemory = {
  readonly grantBytes: number;
  /** The most bytes an allocation asked the grant to hold at once, what it already held included. */
  peakBytes: number;
  bias: number;
  events: ShadowPressure[];
};

export const createShadowMemory = (
  grantBytes = SHADOW_POOL_BYTES - SHADOW_BATCH_GPU_BYTES,
): ShadowMemory => ({
  grantBytes,
  peakBytes: 0,
  bias: 0,
  events: [],
});

/** Asks the grant for `bytes` more beside the `heldBytes` it holds: true, and the peak raised to
 *  their sum, when it holds both; false, and nothing counted, past it. */
export function admitShadowBytes(memory: ShadowMemory, heldBytes: number, bytes: number) {
  const total = heldBytes + bytes;
  if (total > memory.grantBytes) return false;
  memory.peakBytes = Math.max(memory.peakBytes, total);
  return true;
}

/** Records a pressure by name, once per allocation it concerns; `bias` the pool's halvings. */
export function noteShadowPressure(memory: ShadowMemory, name: ShadowPressure, bias = 0) {
  memory.events.push(name);
  memory.bias = Math.max(memory.bias, bias);
}
