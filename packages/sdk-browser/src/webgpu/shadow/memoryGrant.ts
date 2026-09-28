import { SHADOW_GRANT_BYTES } from '../../residency/memoryBudget.ts';

/** A memory-pressure event of the shadows, by name (see `ShadowMemory`). */
export type ShadowPressure =
  'pool-shrunk' | 'pool-refused' | 'static-layer-over-grant' | 'static-layer-refused';

/**
 * THE SHADOW MEMORY GRANT: the one fixed share the GPU budget gives the shadows' pool and layers
 * (`SHADOW_GRANT_BYTES`, the batches' reserve left beside it), never a second budget. The pool is
 * drawn within it (`shadowPoolFor`); a late allocation — the static layer, with the transmittance
 * layer still to come — is asked of it with what is already held (`admitShadowBytes`).
 *
 * Memory pressure never passes for performance: nothing lowers a page to meet a frame time, and
 * each pressure is an event by name. A pool the device refuses is drawn smaller (`pool-shrunk`,
 * `bias` its halvings, 0 whenever the device grants what the budget asks) or not at all
 * (`pool-refused`, shadows off by name); a static layer past the grant (`static-layer-over-grant`)
 * or refused by the device (`static-layer-refused`) is never made, and every page stays drawn
 * whole, every caster at once: no shadow is lost.
 */
export type ShadowMemory = {
  /** The most bytes an allocation asked the grant to hold at once, what it already held included. */
  peakBytes: number;
  bias: number;
  /** Replaced, never mutated, at each event: a frame's metrics publish it without a copy. */
  events: readonly ShadowPressure[];
};

export const createShadowMemory = (): ShadowMemory => ({ peakBytes: 0, bias: 0, events: [] });

/** Asks the grant for `bytes` more beside the `heldBytes` it holds: true, and the peak raised to
 *  their sum, when it holds both; false, and nothing counted, past it. */
export function admitShadowBytes(
  memory: ShadowMemory,
  heldBytes: number,
  bytes: number,
  grantBytes = SHADOW_GRANT_BYTES,
) {
  const total = heldBytes + bytes;
  if (total > grantBytes) return false;
  memory.peakBytes = Math.max(memory.peakBytes, total);
  return true;
}

/** Records a pressure by name, once per allocation it concerns; `bias` the pool's halvings. */
export function noteShadowPressure(memory: ShadowMemory, name: ShadowPressure, bias = 0) {
  memory.events = [...memory.events, name];
  memory.bias = Math.max(memory.bias, bias);
}
